package observability

import "github.com/prometheus/client_golang/prometheus"

// BusinessMetrics exposes the offcon_* custom metrics that power the business
// KPI dashboard + alerts. Services register only the ones they emit.
//
// Example (orchestrator):
//
//	bm := observability.RegisterBusinessMetrics()
//	bm.InstanceSpawns.WithLabelValues("success").Inc()
//	bm.InstancesActive.Set(float64(running))
type BusinessMetrics struct {
	// orchestrator
	InstanceSpawns  *prometheus.CounterVec // result=success|error
	InstancesActive prometheus.Gauge
	// flag-verifier / scoring
	FlagSubmissions *prometheus.CounterVec // result=accepted|rejected
	FlagVerifyErr   prometheus.Counter
	CtfSolves       *prometheus.CounterVec // event_id
	// auth / user
	Signups prometheus.Counter
	// payment
	PaymentAttempts *prometheus.CounterVec // result=succeeded|failed
	SubscriptionMRR prometheus.Gauge
	ActiveSubs      *prometheus.GaugeVec // plan
	// notification
	NotificationQueue prometheus.Gauge
}

// RegisterBusinessMetrics registers all business collectors against the
// service's metrics registry. Unused metrics simply stay at zero.
func RegisterBusinessMetrics() *BusinessMetrics {
	reg := globalMetrics.registry

	bm := &BusinessMetrics{
		InstanceSpawns: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "offcon_instance_spawn_total", Help: "Lab instance spawn attempts.",
		}, []string{"result"}),
		InstancesActive: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "offcon_instances_active", Help: "Currently running lab instances.",
		}),
		FlagSubmissions: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "offcon_flag_submissions_total", Help: "Flag submissions.",
		}, []string{"result"}),
		FlagVerifyErr: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "offcon_flag_verify_errors_total", Help: "Flag verification internal errors.",
		}),
		CtfSolves: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "offcon_ctf_solves_total", Help: "CTF challenge solves.",
		}, []string{"event_id"}),
		Signups: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "offcon_signups_total", Help: "New user signups.",
		}),
		PaymentAttempts: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "offcon_payment_attempts_total", Help: "Payment attempts.",
		}, []string{"result"}),
		SubscriptionMRR: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "offcon_subscription_mrr_cents", Help: "Monthly recurring revenue in cents.",
		}),
		ActiveSubs: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "offcon_active_subscriptions", Help: "Active subscriptions by plan.",
		}, []string{"plan"}),
		NotificationQueue: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "offcon_notification_queue_depth", Help: "Pending notifications in the delivery queue.",
		}),
	}

	reg.MustRegister(
		bm.InstanceSpawns, bm.InstancesActive, bm.FlagSubmissions, bm.FlagVerifyErr,
		bm.CtfSolves, bm.Signups, bm.PaymentAttempts, bm.SubscriptionMRR,
		bm.ActiveSubs, bm.NotificationQueue,
	)
	return bm
}
