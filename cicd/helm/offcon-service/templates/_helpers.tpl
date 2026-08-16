{{/* ===========================================================================
     Template helpers for offcon-service
     =========================================================================== */}}

{{/* Fully-qualified service name */}}
{{- define "offcon-service.name" -}}
{{- required "values.name is required" .Values.name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Image reference — tag falls back to chart appVersion */}}
{{- define "offcon-service.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{/* Standard labels applied to every object */}}
{{- define "offcon-service.labels" -}}
app: {{ include "offcon-service.name" . }}
app.kubernetes.io/name: {{ include "offcon-service.name" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: offcon
tier: {{ .Values.tier }}
language: {{ .Values.language }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/* Selector labels (immutable subset) */}}
{{- define "offcon-service.selectorLabels" -}}
app: {{ include "offcon-service.name" . }}
{{- end -}}

{{/* ServiceAccount name */}}
{{- define "offcon-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{ include "offcon-service.name" . }}
{{- else -}}
default
{{- end -}}
{{- end -}}
