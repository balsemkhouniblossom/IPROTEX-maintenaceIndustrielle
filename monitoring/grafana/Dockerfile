FROM grafana/grafana:12.5.1

USER root

COPY --chown=root:root --chmod=0555 provisioning /etc/grafana/provisioning
COPY --chown=root:root --chmod=0555 dashboards /var/lib/grafana/dashboards

USER grafana
