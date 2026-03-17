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

function trackRequest(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const endpoint = req.route?.path || req.path || 'unknown';
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
  return Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(2));
}

function createMetric(name, value, unit, metricType, valueType, attributes = {}) {
  const source = config.metrics?.source || 'jwt-pizza-service';
  const allAttributes = { ...attributes, source };

  const metric = {
    name,
    unit,
    [metricType]: {
      dataPoints: [
        {
          [valueType]: value,
          timeUnixNano: String(Date.now() * 1000000),
          attributes: [],
        },
      ],
    },
  };

  Object.entries(allAttributes).forEach(([key, val]) => {
    metric[metricType].dataPoints[0].attributes.push({
      key,
      value: { stringValue: String(val) },
    });
  });

  if (metricType === 'sum') {
    metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric[metricType].isMonotonic = true;
  }

  return metric;
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

  const body = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics,
          },
        ],
      },
    ],
  };

  const basicAuth = Buffer.from(
    `${config.metrics.accountId}:${config.metrics.apiKey}`
  ).toString('base64');

  const response = await fetch(config.metrics.endpointUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Grafana push failed: ${response.status}`);
  }
}

async function flushMetrics() {
  const metrics = [];

  Object.entries(state.requests).forEach(([key, count]) => {
    const [method, endpoint, status] = key.split('|');

    metrics.push(
      createMetric(
        'jwt_pizza_http_requests_total',
        count,
        '1',
        'sum',
        'asInt',
        { method, endpoint, status }
      )
    );
  });

  metrics.push(
    createMetric(
      'jwt_pizza_active_users',
      state.activeUsers.size,
      '1',
      'gauge',
      'asInt',
      {}
    )
  );

  metrics.push(
    createMetric(
      'jwt_pizza_auth_attempts_total',
      state.auth.success,
      '1',
      'sum',
      'asInt',
      { result: 'success' }
    )
  );

  metrics.push(
    createMetric(
      'jwt_pizza_auth_attempts_total',
      state.auth.failure,
      '1',
      'sum',
      'asInt',
      { result: 'failure' }
    )
  );

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

  metrics.push(
    createMetric(
      'jwt_pizza_pizzas_sold_total',
      state.pizza.sold,
      '1',
      'sum',
      'asInt',
      {}
    )
  );

  metrics.push(
    createMetric(
      'jwt_pizza_pizza_creation_failures_total',
      state.pizza.failures,
      '1',
      'sum',
      'asInt',
      {}
    )
  );

  metrics.push(
    createMetric(
      'jwt_pizza_revenue_total',
      Number(state.pizza.revenue.toFixed(4)),
      '1',
      'sum',
      'asDouble',
      {}
    )
  );

  metrics.push(
    createMetric(
      'jwt_pizza_http_request_latency_ms_avg',
      average(state.requestLatencies.map((x) => x.duration)),
      'ms',
      'gauge',
      'asDouble',
      {}
    )
  );

  metrics.push(
    createMetric(
      'jwt_pizza_pizza_creation_latency_ms_avg',
      average(state.pizza.latencies),
      'ms',
      'gauge',
      'asDouble',
      {}
    )
  );

  try {
    await sendMetricsToGrafana(metrics);
  } catch (err) {
    console.error('Error pushing metrics:', err.message);
  }

  state.requestLatencies = [];
  state.activeUsers = new Set();
  state.pizza.latencies = [];
}

function start(periodMs = 60000) {
  setInterval(flushMetrics, periodMs);
}

module.exports = {
  requestTracker: trackRequest,
  authAttempt,
  recordActiveUser,
  pizzaPurchase,
  start,
};