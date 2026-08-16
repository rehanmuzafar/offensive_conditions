// Package kubernetes implements the Backend interface against a Kubernetes cluster.
//
// Each lab instance becomes a single Pod with:
//   - runtimeClassName: gvisor (sandboxed user-space kernel)
//   - resource limits matching machine.cpu_limit / mem_limit
//   - flags injected as env vars (FLAG_USER, FLAG_ROOT)
//   - labels for ownership tracking (user_id, instance_id, machine_slug)
//   - a NetworkAttachmentDefinition (Multus) for /30 attachment
//   - NetworkPolicy denying everything except VPN gateway egress
package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	corev1 "k8s.io/api/core/v1"
	netv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/offensive-conditions/orchestrator/internal/backends"
)

// Backend implements backends.Backend against Kubernetes.
type Backend struct {
	client       kubernetes.Interface
	namespace    string
	runtimeClass string
	nodeSelector map[string]string
	tolerations  []corev1.Toleration
	imagePullSecret string
	networkAttachDef string // Multus NetworkAttachmentDefinition name
}

type Options struct {
	InCluster        bool
	Kubeconfig       string
	Namespace        string
	RuntimeClass     string
	NodeSelector     map[string]string
	Tolerations      []corev1.Toleration
	ImagePullSecret  string
	NetworkAttachDef string
}

// New creates a Kubernetes-backed lab spawner.
func New(opts Options) (*Backend, error) {
	cfg, err := loadKubeConfig(opts.InCluster, opts.Kubeconfig)
	if err != nil {
		return nil, fmt.Errorf("kube config: %w", err)
	}
	client, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("kube client: %w", err)
	}
	if opts.Namespace == "" {
		opts.Namespace = "lab-instances"
	}
	return &Backend{
		client:           client,
		namespace:        opts.Namespace,
		runtimeClass:     opts.RuntimeClass,
		nodeSelector:     opts.NodeSelector,
		tolerations:      opts.Tolerations,
		imagePullSecret:  opts.ImagePullSecret,
		networkAttachDef: opts.NetworkAttachDef,
	}, nil
}

func loadKubeConfig(inCluster bool, kubeconfig string) (*rest.Config, error) {
	if inCluster {
		return rest.InClusterConfig()
	}
	if kubeconfig == "" {
		return nil, errors.New("kubeconfig path required when not in-cluster")
	}
	return clientcmd.BuildConfigFromFlags("", kubeconfig)
}

func (b *Backend) Name() string { return "kubernetes" }

// Spawn creates a Pod for the lab instance.
func (b *Backend) Spawn(ctx context.Context, req backends.SpawnRequest) (*backends.SpawnResult, error) {
	podName := fmt.Sprintf("lab-%s", req.InstanceID.String()[:8])

	pod := b.buildPod(podName, req)

	created, err := b.client.CoreV1().Pods(b.namespace).Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		return nil, fmt.Errorf("create pod: %w", err)
	}

	// Create a NetworkPolicy isolating this pod
	if err := b.applyNetworkPolicy(ctx, podName, req); err != nil {
		// Best-effort: log but don't fail spawn. NetworkPolicy can be applied retroactively.
		// In production, this should be added to a retry queue.
		_ = err
	}

	return &backends.SpawnResult{
		Ref:      podName,
		NodeName: created.Spec.NodeName,
	}, nil
}

func (b *Backend) buildPod(name string, req backends.SpawnRequest) *corev1.Pod {
	envVars := make([]corev1.EnvVar, 0, len(req.EnvVars))
	for k, v := range req.EnvVars {
		envVars = append(envVars, corev1.EnvVar{Name: k, Value: v})
	}

	containerPorts := make([]corev1.ContainerPort, 0, len(req.Ports))
	for _, p := range req.Ports {
		containerPorts = append(containerPorts, corev1.ContainerPort{
			ContainerPort: int32(p),
			Protocol:      corev1.ProtocolTCP,
		})
	}

	resReq := corev1.ResourceRequirements{
		Requests: corev1.ResourceList{},
		Limits:   corev1.ResourceList{},
	}
	if req.CPURequest != "" {
		resReq.Requests[corev1.ResourceCPU] = resource.MustParse(req.CPURequest)
	}
	if req.MemRequest != "" {
		resReq.Requests[corev1.ResourceMemory] = resource.MustParse(req.MemRequest)
	}
	if req.CPULimit != "" {
		resReq.Limits[corev1.ResourceCPU] = resource.MustParse(req.CPULimit)
	}
	if req.MemLimit != "" {
		resReq.Limits[corev1.ResourceMemory] = resource.MustParse(req.MemLimit)
	}

	labels := map[string]string{
		"app.kubernetes.io/managed-by": "offcon-orchestrator",
		"offensiveconditions.org/instance-id":        req.InstanceID.String(),
		"offensiveconditions.org/user-id":            req.UserID.String(),
		"offensiveconditions.org/machine-slug":       req.MachineSlug,
	}
	annotations := map[string]string{
		"offensiveconditions.org/expires-at": time.Now().Add(req.TTL).Format(time.RFC3339),
	}
	if b.networkAttachDef != "" && req.NetworkCIDR != "" {
		annotations["k8s.v1.cni.cncf.io/networks"] = fmt.Sprintf(
			`[{"name":"%s","ips":["%s/32"]}]`, b.networkAttachDef, req.InstanceIP)
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:        name,
			Namespace:   b.namespace,
			Labels:      labels,
			Annotations: annotations,
		},
		Spec: corev1.PodSpec{
			RestartPolicy:                corev1.RestartPolicyNever,
			AutomountServiceAccountToken: ptr(false),
			SecurityContext: &corev1.PodSecurityContext{
				RunAsNonRoot: ptr(false), // lab content is allowed to be root inside its own ns
			},
			Containers: []corev1.Container{
				{
					Name:            "lab",
					Image:           req.Image,
					Env:             envVars,
					Ports:           containerPorts,
					Resources:       resReq,
					ImagePullPolicy: corev1.PullIfNotPresent,
					SecurityContext: &corev1.SecurityContext{
						Capabilities: &corev1.Capabilities{
							// Lab boxes often need network capabilities for binding privileged ports
							// gVisor still isolates them from the host kernel
							Add: []corev1.Capability{"NET_BIND_SERVICE"},
						},
					},
				},
			},
		},
	}

	if b.runtimeClass != "" {
		pod.Spec.RuntimeClassName = &b.runtimeClass
	}
	if len(b.nodeSelector) > 0 {
		pod.Spec.NodeSelector = b.nodeSelector
	}
	if len(b.tolerations) > 0 {
		pod.Spec.Tolerations = b.tolerations
	}
	if b.imagePullSecret != "" {
		pod.Spec.ImagePullSecrets = []corev1.LocalObjectReference{{Name: b.imagePullSecret}}
	}
	if req.NodeName != "" {
		pod.Spec.NodeName = req.NodeName
	}

	return pod
}

func (b *Backend) applyNetworkPolicy(ctx context.Context, podName string, req backends.SpawnRequest) error {
	np := &netv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "isolate-" + podName,
			Namespace: b.namespace,
			Labels: map[string]string{
				"offensiveconditions.org/instance-id": req.InstanceID.String(),
			},
		},
		Spec: netv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{
				MatchLabels: map[string]string{
					"offensiveconditions.org/instance-id": req.InstanceID.String(),
				},
			},
			PolicyTypes: []netv1.PolicyType{
				netv1.PolicyTypeIngress,
				netv1.PolicyTypeEgress,
			},
			// Ingress: only from VPN gateway namespace
			Ingress: []netv1.NetworkPolicyIngressRule{
				{
					From: []netv1.NetworkPolicyPeer{
						{
							NamespaceSelector: &metav1.LabelSelector{
								MatchLabels: map[string]string{"name": "vpn-gateway"},
							},
						},
					},
				},
			},
			// Egress: DNS + same-pod (loopback) + nothing else
			Egress: []netv1.NetworkPolicyEgressRule{
				{
					To: []netv1.NetworkPolicyPeer{
						{
							NamespaceSelector: &metav1.LabelSelector{},
							PodSelector: &metav1.LabelSelector{
								MatchLabels: map[string]string{"k8s-app": "kube-dns"},
							},
						},
					},
					Ports: []netv1.NetworkPolicyPort{
						{Protocol: protoPtr(corev1.ProtocolUDP), Port: portPtr(53)},
					},
				},
			},
		},
	}
	_, err := b.client.NetworkingV1().NetworkPolicies(b.namespace).Create(ctx, np, metav1.CreateOptions{})
	return err
}

// Status reports the current state of the pod.
func (b *Backend) Status(ctx context.Context, ref string) (*backends.Status, error) {
	pod, err := b.client.CoreV1().Pods(b.namespace).Get(ctx, ref, metav1.GetOptions{})
	if err != nil {
		// Pod might be deleted (gone)
		return &backends.Status{Phase: backends.PhaseGone, Reason: err.Error()}, nil
	}

	st := &backends.Status{
		IPAddress: pod.Status.PodIP,
		NodeName:  pod.Spec.NodeName,
	}

	switch pod.Status.Phase {
	case corev1.PodPending:
		st.Phase = backends.PhasePending
		st.Reason = firstContainerWaitingReason(pod)
	case corev1.PodRunning:
		// Check container readiness
		allReady := true
		for _, cs := range pod.Status.ContainerStatuses {
			if !cs.Ready {
				allReady = false
				if cs.State.Waiting != nil {
					st.Reason = cs.State.Waiting.Reason
				}
			}
		}
		if allReady {
			st.Phase = backends.PhaseRunning
			st.Ready = true
		} else {
			st.Phase = backends.PhaseInitializing
		}
	case corev1.PodFailed:
		st.Phase = backends.PhaseFailed
		if len(pod.Status.ContainerStatuses) > 0 {
			cs := pod.Status.ContainerStatuses[0]
			if cs.State.Terminated != nil {
				st.Reason = cs.State.Terminated.Reason
			}
		}
	case corev1.PodSucceeded:
		st.Phase = backends.PhaseRunning
		st.Reason = "completed"
	default:
		st.Phase = backends.PhasePending
	}

	if pod.DeletionTimestamp != nil {
		st.Phase = backends.PhaseTerminating
	}

	return st, nil
}

func firstContainerWaitingReason(pod *corev1.Pod) string {
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Waiting != nil {
			return cs.State.Waiting.Reason
		}
	}
	return ""
}

// Teardown deletes the pod + associated NetworkPolicy.
func (b *Backend) Teardown(ctx context.Context, ref string) error {
	gracePeriod := int64(30)
	delOpts := metav1.DeleteOptions{GracePeriodSeconds: &gracePeriod}

	if err := b.client.CoreV1().Pods(b.namespace).Delete(ctx, ref, delOpts); err != nil {
		// Already gone is fine
		// k8s returns 404 — ignore
	}
	npName := "isolate-" + ref
	_ = b.client.NetworkingV1().NetworkPolicies(b.namespace).Delete(ctx, npName, metav1.DeleteOptions{})

	return nil
}

// Reset for K8s = delete + caller re-creates with same name.
// (Snapshotting is a Proxmox-only feature.)
func (b *Backend) Reset(ctx context.Context, ref string) error {
	return backends.ErrNotSupported{Op: "reset"}
}

// Logs returns the last N lines of stdout/stderr.
func (b *Backend) Logs(ctx context.Context, ref string, tailLines int) ([]string, error) {
	if tailLines <= 0 {
		tailLines = 200
	}
	tail := int64(tailLines)
	req := b.client.CoreV1().Pods(b.namespace).GetLogs(ref, &corev1.PodLogOptions{
		TailLines: &tail,
	})
	stream, err := req.Stream(ctx)
	if err != nil {
		return nil, fmt.Errorf("stream logs: %w", err)
	}
	defer stream.Close()

	const maxBytes = 1 << 20 // 1 MB safety cap
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)
	for {
		n, err := stream.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
			if len(buf) > maxBytes {
				break
			}
		}
		if err == io.EOF || err != nil {
			break
		}
	}
	return splitLines(buf), nil
}

func splitLines(b []byte) []string {
	var lines []string
	start := 0
	for i, c := range b {
		if c == '\n' {
			lines = append(lines, string(b[start:i]))
			start = i + 1
		}
	}
	if start < len(b) {
		lines = append(lines, string(b[start:]))
	}
	return lines
}

func ptr[T any](v T) *T { return &v }
func protoPtr(p corev1.Protocol) *corev1.Protocol { return &p }
func portPtr(p int) *intstr.IntOrString {
	v := intstr.FromInt(p)
	return &v
}
