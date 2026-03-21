const config = require('./config').metrics;
const os = require('os');

const unprocessedData = {
  http_requests: {
    total: 0,
    get: 0,
    put: 0,
    post: 0,
    delete: 0,
  },

  endpoint_requests: {},

  endpoint_latency_windows: {},

  auth_success: 0,
  auth_failure: 0,

  active_users: new Map(),

  pizzas_sold: 0,
  pizza_creation_failures: 0,
  revenue: 0,
  pizza_latency_window: [],
};

const requestTracker = (req, res, next) => {
  const start = Date.now();
  let handled = false;

  const handler = () => {
    if (handled) {
      return;
    }
    handled = true;

    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
      return;
    }

    const duration = Date.now() - start;
    const cleanUrl = (req.originalUrl || req.path || 'unknown').split('?')[0];
    const endpoint = `[${req.method}] ${cleanUrl}`;

    unprocessedData.http_requests.total += 1;

    switch (req.method) {
      case 'GET':
        unprocessedData.http_requests.get += 1;
        break;
      case 'PUT':
        unprocessedData.http_requests.put += 1;
        break;
      case 'POST':
        unprocessedData.http_requests.post += 1;
        break;
      case 'DELETE':
        unprocessedData.http_requests.delete += 1;
        break;
    }

    unprocessedData.endpoint_requests[endpoint] = (unprocessedData.endpoint_requests[endpoint] || 0) + 1;

    if (!unprocessedData.endpoint_latency_windows[endpoint]) {
      unprocessedData.endpoint_latency_windows[endpoint] = [];
    }
    unprocessedData.endpoint_latency_windows[endpoint].push(duration);
  };

  res.on('finish', handler);
  res.on('close', handler);
  next();
};

function authAttempt(success, userId = null) {
  if (success) {
    unprocessedData.auth_success += 1;

    if (userId !== null && userId !== undefined) {
      unprocessedData.active_users.set(String(userId), Date.now());
    }
  } else {
    unprocessedData.auth_failure += 1;
  }
}

function userLoggedOut(userId) {
  if (userId !== null && userId !== undefined) {
    unprocessedData.active_users.delete(String(userId));
  }
}

function pizzaPurchase(success, latencyMs, pizzaCount = 0, revenueAmount = 0) {
  const numericLatency = Number(latencyMs);
  if (Number.isFinite(numericLatency)) {
    unprocessedData.pizza_latency_window.push(numericLatency);
  }

  if (success) {
    unprocessedData.pizzas_sold += Number(pizzaCount) || 0;
    unprocessedData.revenue += Number(revenueAmount) || 0;
  } else {
    unprocessedData.pizza_creation_failures += 1;
  }
}

class MetricBuilder {
  constructor() {
    this.metrics = [];
  }

  append(metricName, metricValue, type, unit, attributes = {}) {
    const numericValue = Number(metricValue);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    const valueField = Number.isInteger(numericValue) ? 'asInt' : 'asDouble';

    const dataPoint = {
      [valueField]: numericValue,
      timeUnixNano: String(Date.now() * 1000000),
      attributes: [
        {
          key: 'source',
          value: { stringValue: config.source },
        },
      ],
    };

    Object.entries(attributes).forEach(([key, value]) => {
      dataPoint.attributes.push({
        key,
        value: { stringValue: String(value) },
      });
    });

    this.metrics.push({
      name: metricName,
      unit,
      [type]: {
        dataPoints: [dataPoint],
        ...(type === 'sum' && {
          aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE',
          isMonotonic: true,
        }),
      },
    });
  }

  toString() {
    return JSON.stringify({
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: this.metrics,
            },
          ],
        },
      ],
    });
  }
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
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

async function sendMetricToGrafana(body) {
  if (!config.endpointUrl || !config.accountId || !config.apiKey) {
    console.error('Missing Grafana metrics config');
    return;
  }

  const response = await fetch(config.endpointUrl, {
    method: 'POST',
    body,
    headers: {
      Authorization: `Bearer ${config.accountId}:${config.apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Failed to push metrics data to Grafana: ${text}`);
    console.error(body);
  }
}

function zeroOutWindows() {
  unprocessedData.endpoint_latency_windows = {};
  unprocessedData.pizza_latency_window = [];
}

function httpMetrics(builder) {
  builder.append('http_requests', unprocessedData.http_requests.total, 'sum', '1', { method: 'TOTAL' });
  builder.append('http_requests', unprocessedData.http_requests.get, 'sum', '1', { method: 'GET' });
  builder.append('http_requests', unprocessedData.http_requests.put, 'sum', '1', { method: 'PUT' });
  builder.append('http_requests', unprocessedData.http_requests.post, 'sum', '1', { method: 'POST' });
  builder.append('http_requests', unprocessedData.http_requests.delete, 'sum', '1', { method: 'DELETE' });

  Object.entries(unprocessedData.endpoint_requests).forEach(([endpoint, count]) => {
    builder.append('endpoint_requests', count, 'sum', '1', { endpoint });
  });

  Object.entries(unprocessedData.endpoint_latency_windows).forEach(([endpoint, values]) => {
    builder.append('service_endpoint_latency', average(values), 'gauge', 'ms', { endpoint });
  });
}

function systemMetrics(builder) {
  builder.append('cpu_usage', getCpuUsagePercentage(), 'gauge', '%');
  builder.append('memory_usage', getMemoryUsagePercentage(), 'gauge', '%');
}

function userMetrics(builder) {
  builder.append('active_users', unprocessedData.active_users.size, 'gauge', '1');
}

function purchaseMetrics(builder) {
  builder.append('pizzas_sold', unprocessedData.pizzas_sold, 'sum', '1');
  builder.append('pizza_creation_failures', unprocessedData.pizza_creation_failures, 'sum', '1');
  builder.append('revenue', Number(unprocessedData.revenue.toFixed(4)), 'sum', '1');
  builder.append('pizza_creation_latency', average(unprocessedData.pizza_latency_window), 'gauge', 'ms');
}

function authMetrics(builder) {
  builder.append('auth_attempts', unprocessedData.auth_success, 'sum', '1', { result: 'success' });
  builder.append('auth_attempts', unprocessedData.auth_failure, 'sum', '1', { result: 'failure' });
}

function sendMetricsPeriodically(period) {
  return setInterval(async () => {
    try {
      const buf = new MetricBuilder();

      httpMetrics(buf);
      systemMetrics(buf);
      userMetrics(buf);
      purchaseMetrics(buf);
      authMetrics(buf);

      const metrics = buf.toString();
      await sendMetricToGrafana(metrics);

      zeroOutWindows();
    } catch (error) {
      console.log('Error sending metrics', error);
    }
  }, period);
}

function start(period = 60000) {
  return sendMetricsPeriodically(period);
}

module.exports = {
  requestTracker,
  authAttempt,
  userLoggedOut,
  pizzaPurchase,
  start,
};