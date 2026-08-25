FROM prom/prometheus:v3.7.3

COPY prometheus.template.yml /etc/prometheus/prometheus.template.yml
COPY alerts.yml /etc/prometheus/alerts.yml
COPY --chmod=755 render-entrypoint.sh /usr/local/bin/render-entrypoint.sh

USER nobody
ENTRYPOINT ["/usr/local/bin/render-entrypoint.sh"]
