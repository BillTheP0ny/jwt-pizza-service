const os = require('os');
const config = require('./config');

const state = {
  requests: {},
  requestLatencies: [],
  activeUsers: new Set(),

  auth: {
    success: 0,
    failure: 0,
  },

  pizza: {
    sold: 0,
    failures: 0,
    revenue: 0,
    latencies: [],
  },
};

let timer = null;
let flushInProgress = false;

// Use BigInt so OTLP nanosecond timestamps stay precise.
const processStartUnixNano = (BigInt(Date.now()) * 1000000n).toString();

function nowUnixNano() {
  return (BigInt(Date.now()) * 1000000n).toString();
}

function toOtlpStringAttribute(key, value) {
  return {
    key,
    value: { stringValue: String(value) },
  };
}

function buildDataPointAttributes(attributes = {}) {
  const source = config.metrics?.source || 'jwt-pizza-service';
  const merged = { ...attributes, source };

  return Object.entries(merged)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => toOtlpStringAttribute(key, value));
}

function buildResourceAttributes() {
  const source = config.metrics?.source || 'jwt-pizza-service';
  const environment = source.endsWith('-dev') ? 'development' : 'production';

  return [
    toOtlpStringAttribute('service.name', source),
    toOtlpStringAttribute('service.namespace', 'jwt-pizza-service'),
    toOtlpStringAttribute('service.instance.id', os.hostname()),
    toOtlpStringAttribute('deployment.environment', environment),
    toOtlpStringAttribute('source', source),
  ];
}

function normalizeEndpoint(req) {
  const base = req.baseUrl || '';
  const routePath = req.route?.path || req.path || 'unknown';
  return `${base}${routePath}` || 'unknown';
}

function trackRequest(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const endpoint = normalizeEndpoint(req);
    const method = req.method;
    const status = String(res.statusCode);
    const key = `${method}|${endpoint}|${status}`;

    state.requests[key] = (state.requests[key] || 0) + 1;

    state.requestLatencies.push({
      method,
      endpoint,
      status,
      duration: Date.now() - start,
    });

    if (req.user?.id) {
      state.activeUsers.add(String(req.user.id));
    }
  });

  next();
}

function authAttempt(success, userId = null) {
  if (success) {
    state.auth.success += 1;
    if (userId) {
      state.activeUsers.add(String(userId));
    }
  } else {
    state.auth.failure += 1;
  }
}

function recordActiveUser(userId) {
  if (userId) {
    state.activeUsers.add(String(userId));
  }
}

function pizzaPurchase(success, latencyMs, pizzaCount = 0, revenueAmount = 0) {
  state.pizza.latencies.push(Number(latencyMs) || 0);

  if (success) {
    state.pizza.sold += Number(pizzaCount) || 0;
    state.pizza.revenue += Number(revenueAmount) || 0;
  } else {
    state.pizza.failures += 1;
  }
}

function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return Number((cpuUsage * 100).toFixed(2));
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  return Number(((usedMemory / totalMemory) * 100).toFixed(2));
}

function average(values) {
  if (!values.length) return 0;
  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)
  );
}

function createMetric(name, value, unit, metricType, valueType, attributes = {}) {
  const dataPoint = {
    [valueType]: value,
    timeUnixNano: nowUnixNano(),
    attributes: buildDataPointAttributes(attributes),
  };

  const metric = {
    name,
    unit,
    [metricType]: {
      dataPoints: [dataPoint],
    },
  };

  if (metricType === 'sum') {
    metric.sum.aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric.sum.isMonotonic = true;
    metric.sum.dataPoints[0].startTimeUnixNano = processStartUnixNano;
  }

  return metric;
}

function buildRequestLatencyMetrics() {
  const grouped = {};

  for (const item of state.requestLatencies) {
    const key = `${item.method}|${item.endpoint}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(item.duration);
  }

  return Object.entries(grouped).map(([key, durations]) => {
    const [method, endpoint] = key.split('|');

    return createMetric(
      'jwt_pizza_http_request_latency_ms',
      average(durations),
      'ms',
      'gauge',
      'asDouble',
      { method, endpoint }
    );
  });
}

async function sendMetricsToGrafana(metrics) {
  if (
    !config.metrics?.endpointUrl ||
    !config.metrics?.accountId ||
    !config.metrics?.apiKey
  ) {
    console.log('Metrics config missing; skipping Grafana push');
    return;
  }

  const auth = Buffer.from(
    `${config.metrics.accountId}:${config.metrics.apiKey}`
  ).toString('base64');

  const body = {
    resourceMetrics: [
      {
        resource: {
          attributes: buildResourceAttributes(),
        },
        scopeMetrics: [
          {
            scope: {
              name: 'jwt-pizza-service-manual-metrics',
              version: '1.0.0',
            },
            metrics,
          },
        ],
      },
    ],
  };

  console.log('Sending metrics to Grafana', {
    endpointUrl: config.metrics.endpointUrl,
    source: config.metrics.source,
    metricCount: metrics.length,
  });

  const response = await fetch(config.metrics.endpointUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  console.log('Grafana response', response.status, text);

  if (!response.ok) {
    throw new Error(`Grafana push failed: ${response.status} ${text}`);
  }
}

async function flushMetrics() {
  if (flushInProgress) {
    console.log('Skipping metrics flush; previous flush still in progress');
    return;
  }

  flushInProgress = true;

  try {
    const metrics = [];

    // HTTP requests by method/endpoint/status (monotonic counter)
    Object.entries(state.requests).forEach(([key, count]) => {
      const [method, endpoint, status] = key.split('|');

      metrics.push(
        createMetric(
          'jwt_pizza_http_requests',
          count,
          '',
          'sum',
          'asInt',
          { method, endpoint, status }
        )
      );
    });

    // Active users seen during the current flush window
    metrics.push(
      createMetric(
        'jwt_pizza_active_users',
        state.activeUsers.size,
        '',
        'gauge',
        'asInt',
        {}
      )
    );

    // Auth attempts (monotonic counters)
    metrics.push(
      createMetric(
        'jwt_pizza_auth_attempts',
        state.auth.success,
        '',
        'sum',
        'asInt',
        { result: 'success' }
      )
    );

    metrics.push(
      createMetric(
        'jwt_pizza_auth_attempts',
        state.auth.failure,
        '',
        'sum',
        'asInt',
        { result: 'failure' }
      )
    );

    // CPU and memory usage
    metrics.push(
      createMetric(
        'jwt_pizza_cpu_usage_percent',
        getCpuUsagePercentage(),
        '%',
        'gauge',
        'asDouble',
        {}
      )
    );

    metrics.push(
      createMetric(
        'jwt_pizza_memory_usage_percent',
        getMemoryUsagePercentage(),
        '%',
        'gauge',
        'asDouble',
        {}
      )
    );

    // Pizza metrics (monotonic counters)
    metrics.push(
      createMetric(
        'jwt_pizza_pizzas_sold',
        state.pizza.sold,
        '',
        'sum',
        'asInt',
        {}
      )
    );

    metrics.push(
      createMetric(
        'jwt_pizza_pizza_creation_failures',
        state.pizza.failures,
        '',
        'sum',
        'asInt',
        {}
      )
    );

    metrics.push(
      createMetric(
        'jwt_pizza_revenue',
        Number(state.pizza.revenue.toFixed(4)),
        '',
        'sum',
        'asDouble',
        {}
      )
    );

    // Endpoint latency averages for the current flush window
    metrics.push(...buildRequestLatencyMetrics());

    // Pizza creation latency average for the current flush window
    metrics.push(
      createMetric(
        'jwt_pizza_pizza_creation_latency_ms',
        average(state.pizza.latencies),
        'ms',
        'gauge',
        'asDouble',
        {}
      )
    );

    await sendMetricsToGrafana(metrics);
  } catch (err) {
    console.error('Error pushing metrics:', err.message);
  } finally {
    // Reset only windowed gauges/latencies; keep cumulative counters.
    state.requestLatencies = [];
    state.activeUsers = new Set();
    state.pizza.latencies = [];
    flushInProgress = false;
  }
}

function start(periodMs = 15000) {
  if (timer) {
    return;
  }

  timer = setInterval(flushMetrics, periodMs);
}

module.exports = {
  requestTracker: trackRequest,
  authAttempt,
  recordActiveUser,
  pizzaPurchase,
  start,
};