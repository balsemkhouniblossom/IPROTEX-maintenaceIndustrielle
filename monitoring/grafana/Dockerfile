FROM grafana/grafana:12.4.9

USER root

COPY --chown=root:root --chmod=0555 provisioning /etc/grafana/provisioning
COPY --chown=root:root --chmod=0555 dashboards /etc/grafana/dashboards
COPY --chown=root:root --chmod=0555 render-entrypoint.sh /usr/local/bin/render-entrypoint.sh

USER grafana
ENTRYPOINT ["/usr/local/bin/render-entrypoint.sh"]
