// Kubernetes operator that reconciles `LabInstance` CRDs.
//
// In production we have two control planes:
//   1. Application API (cmd/server) — creates rows in PostgreSQL + Pods directly.
//      Fast path for user-initiated spawns; the source of truth for billing/quota.
//   2. CRD-based (this operator) — for GitOps workflows and resilience.
//      If a Pod is deleted out-of-band, the operator recreates it within seconds.
//      Useful for admin-driven imports (e.g. seeding the cluster from YAML).
//
// The CRD schema lives at crd/labinstance_v1.yaml.
//
// NOTE: This file uses the unstructured client to avoid hand-writing the typed
// Go API for the CRD. In production you'd run `controller-gen` to generate the
// typed types from the schema and replace the unstructured calls.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/rs/zerolog"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var (
	scheme = runtime.NewScheme()

	labInstanceGVK = schema.GroupVersionKind{
		Group:   "offensiveconditions.org",
		Version: "v1",
		Kind:    "LabInstance",
	}
)

func init() {
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
}

func main() {
	var (
		metricsAddr string
		probeAddr   string
		leaderElect bool
	)
	flag.StringVar(&metricsAddr, "metrics-bind-address", ":8080", "metrics endpoint")
	flag.StringVar(&probeAddr, "health-probe-bind-address", ":8081", "health probe endpoint")
	flag.BoolVar(&leaderElect, "leader-elect", false, "enable leader election")
	flag.Parse()

	ctrl.SetLogger(zap.New(zap.UseDevMode(false)))
	logger := zerolog.New(os.Stdout).With().Timestamp().Str("svc", "orchestrator-operator").Logger()

	cfg, err := ctrl.GetConfig()
	if err != nil {
		logger.Fatal().Err(err).Msg("get kubeconfig")
	}

	mgr, err := ctrl.NewManager(cfg, ctrl.Options{
		Scheme:                 scheme,
		LeaderElection:         leaderElect,
		LeaderElectionID:       "orchestrator-operator.offensiveconditions.org",
		HealthProbeBindAddress: probeAddr,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("create manager")
	}

	r := &LabInstanceReconciler{
		Client: mgr.GetClient(),
		Log:    logger,
	}
	if err := r.SetupWithManager(mgr); err != nil {
		logger.Fatal().Err(err).Msg("setup reconciler")
	}

	if err := mgr.AddHealthzCheck("healthz", healthz.Ping); err != nil {
		logger.Fatal().Err(err).Msg("add healthz")
	}
	if err := mgr.AddReadyzCheck("readyz", healthz.Ping); err != nil {
		logger.Fatal().Err(err).Msg("add readyz")
	}

	logger.Info().
		Str("metrics_addr", metricsAddr).
		Str("probe_addr", probeAddr).
		Bool("leader_elect", leaderElect).
		Msg("operator starting")

	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		logger.Fatal().Err(err).Msg("manager start failed")
	}
}

// LabInstanceReconciler reconciles LabInstance CRDs.
type LabInstanceReconciler struct {
	client.Client
	Log zerolog.Logger
}

func (r *LabInstanceReconciler) SetupWithManager(mgr ctrl.Manager) error {
	li := &unstructured.Unstructured{}
	li.SetGroupVersionKind(labInstanceGVK)

	return ctrl.NewControllerManagedBy(mgr).
		Named("labinstance").
		For(li).
		Owns(&corev1.Pod{}).
		Complete(r)
}

// Reconcile ensures the desired Pod exists for each LabInstance CR.
func (r *LabInstanceReconciler) Reconcile(ctx context.Context, req reconcile.Request) (reconcile.Result, error) {
	log := r.Log.With().
		Str("name", req.Name).
		Str("namespace", req.Namespace).
		Logger()

	li := &unstructured.Unstructured{}
	li.SetGroupVersionKind(labInstanceGVK)
	if err := r.Get(ctx, req.NamespacedName, li); err != nil {
		if apierrors.IsNotFound(err) {
			return reconcile.Result{}, nil
		}
		return reconcile.Result{}, err
	}

	spec, found, err := unstructured.NestedMap(li.Object, "spec")
	if err != nil || !found {
		log.Warn().Msg("LabInstance has no spec")
		return reconcile.Result{}, nil
	}
	phase, _ := spec["phase"].(string)
	machineImage, _ := spec["image"].(string)
	instanceID, _ := spec["instanceID"].(string)
	userID, _ := spec["userID"].(string)

	if instanceID == "" {
		log.Warn().Msg("LabInstance missing instanceID")
		return reconcile.Result{}, nil
	}

	podName := "lab-" + truncate(instanceID, 8)
	podKey := types.NamespacedName{Name: podName, Namespace: req.Namespace}

	switch phase {
	case "terminating", "terminated", "expired", "failed":
		var pod corev1.Pod
		if err := r.Get(ctx, podKey, &pod); err == nil {
			if err := r.Delete(ctx, &pod); err != nil && !apierrors.IsNotFound(err) {
				return reconcile.Result{}, err
			}
		}
		return reconcile.Result{}, nil

	case "spawning", "running", "":
		var pod corev1.Pod
		err := r.Get(ctx, podKey, &pod)
		if apierrors.IsNotFound(err) {
			newPod := buildPod(podName, req.Namespace, instanceID, userID, machineImage)
			if err := setOwnerRef(li, newPod); err != nil {
				return reconcile.Result{}, err
			}
			if err := r.Create(ctx, newPod); err != nil {
				return reconcile.Result{}, err
			}
			log.Info().Str("pod", podName).Msg("pod created from CR")
			return reconcile.Result{RequeueAfter: 10 * time.Second}, nil
		}
		if err != nil {
			return reconcile.Result{}, err
		}
		// Pod exists; status sync is handled by the main service via its own status poller.
		return reconcile.Result{RequeueAfter: 30 * time.Second}, nil
	}

	return reconcile.Result{}, nil
}

func truncate(s string, n int) string {
	if len(s) < n {
		return s
	}
	return s[:n]
}

func buildPod(name, namespace, instanceID, userID, image string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "offcon-orchestrator-operator",
				"offensiveconditions.org/instance-id":        instanceID,
				"offensiveconditions.org/user-id":            userID,
			},
		},
		Spec: corev1.PodSpec{
			RestartPolicy: corev1.RestartPolicyNever,
			Containers: []corev1.Container{
				{Name: "lab", Image: image},
			},
		},
	}
}

func setOwnerRef(owner *unstructured.Unstructured, child *corev1.Pod) error {
	uid := owner.GetUID()
	name := owner.GetName()
	if uid == "" || name == "" {
		return fmt.Errorf("owner missing metadata")
	}
	t := true
	child.OwnerReferences = []metav1.OwnerReference{
		{
			APIVersion: labInstanceGVK.GroupVersion().String(),
			Kind:       labInstanceGVK.Kind,
			Name:       name,
			UID:        uid,
			Controller: &t,
		},
	}
	return nil
}
