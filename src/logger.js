const config = require('./config').logging;

class Logger {
  httpLogger = (req, res, next) => {
    const originalSend = res.send.bind(res);

    res.send = (resBody) => {
      try {
        const logData = {
          authorized: !!req.headers.authorization,
          ip: req.ip,
          path: req.originalUrl,
          method: req.method,
          statusCode: res.statusCode,
          reqBody: this.sanitizeField(req.body ?? null),
          resBody: this.sanitizeField(this.tryParseBody(resBody)),
        };

        const level = this.statusToLogLevel(res.statusCode);
        this.log(level, 'http', logData);
      } catch (err) {
        console.log('Failed to build HTTP log', err.message);
      }

      return originalSend(resBody);
    };

    next();
  };

  log(level, type, logData) {
    const labels = {
      component: config.source,
      level,
      type,
    };

    const values = [[this.nowString(), this.safeStringify(this.maskSensitive(logData))]];
    const logEvent = {
      streams: [
        {
          stream: labels,
          values,
        },
      ],
    };

    this.sendLogToGrafana(logEvent);
  }

  db(query, params = null) {
    this.log('info', 'db', {
      query,
      params: this.sanitizeField(params),
    });
  }

  factoryRequest(body) {
    this.log('info', 'factory-request', {
      reqBody: this.sanitizeField(body),
    });
  }

  factoryResponse(statusCode, body) {
    this.log(this.statusToLogLevel(statusCode), 'factory-response', {
      statusCode,
      resBody: this.sanitizeField(body),
    });
  }

  exception(err, req = null) {
    this.log('error', 'exception', {
      message: err?.message || 'unknown error',
      stack: err?.stack || null,
      path: req?.originalUrl || null,
      method: req?.method || null,
      authorized: !!req?.headers?.authorization,
      reqBody: this.sanitizeField(req?.body ?? null),
    });
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  nowString() {
    return (Date.now() * 1000000).toString();
  }

  tryParseBody(body) {
    if (body === undefined || body === null) return null;
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }
    return body;
  }

  safeStringify(value) {
    if (value === undefined) return 'null';
    if (typeof value === 'string') return value;

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  sanitizeField(value) {
    return this.safeStringify(this.maskSensitive(value));
  }

  maskSensitive(value) {
    if (Array.isArray(value)) {
      return value.map((item) => this.maskSensitive(item));
    }

    if (value && typeof value === 'object') {
      const cleaned = {};

      for (const [key, val] of Object.entries(value)) {
        if (this.isSensitiveKey(key)) {
          cleaned[key] = '*****';
        } else {
          cleaned[key] = this.maskSensitive(val);
        }
      }

      return cleaned;
    }

    return value;
  }

  isSensitiveKey(key) {
    const normalized = String(key).toLowerCase();
    return [
      'password',
      'token',
      'jwt',
      'apikey',
      'api_key',
      'authorization',
      'session',
      'sessionkey',
      'session_key',
    ].includes(normalized);
  }

  async sendLogToGrafana(event) {
    if (
      !config?.endpointUrl ||
      !config?.accountId ||
      !config?.apiKey ||
      !config?.source
    ) {
      console.log('Missing logging config');
      return;
    }

    const body = JSON.stringify(event);

    try {
      const res = await fetch(config.endpointUrl, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.accountId}:${config.apiKey}`,
        },
      });
//dedededede
      if (!res.ok) {
        const text = await res.text();
        console.log('Failed to send log to Grafana', res.status, text);
      }
    } catch (err) {
      console.log('Error sending log to Grafana', err.message);
    }
  }
}

module.exports = new Logger();