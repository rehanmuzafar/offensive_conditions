module github.com/offensive-conditions/orchestrator

go 1.22

require (
	github.com/gin-gonic/gin v1.10.0
	github.com/go-playground/validator/v10 v10.22.0
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.6.0
	github.com/prometheus/client_golang v1.20.2
	github.com/redis/go-redis/v9 v9.6.1
	github.com/rs/zerolog v1.33.0
	github.com/segmentio/kafka-go v0.4.47
	github.com/spf13/viper v1.19.0
	github.com/stretchr/testify v1.9.0
	google.golang.org/grpc v1.65.0
	k8s.io/api v0.30.3
	k8s.io/apimachinery v0.30.3
	k8s.io/client-go v0.30.3
	sigs.k8s.io/controller-runtime v0.18.4
)
