const config = require('./config').logging;

class Logger {
  httpLogger = (req, res, next) => {
    const originalSend = res.send.bind(res);

    res.send = (resBody) => {
      try {
        const logData = {
          authorized: !!req.headers.authorization,
          path: req.originalUrl,
          method: req.method,
          statusCode: res.statusCode,
          reqBody: req.body ?? null,
          resBody: this.tryParseBody(resBody),
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

    const values = [[this.nowString(), this.sanitize(logData)]];
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
      params,
    });
  }

  factoryRequest(body) {
    this.log('info', 'factory-request', {
      body,
    });
  }

  factoryResponse(statusCode, body) {
    this.log(this.statusToLogLevel(statusCode), 'factory-response', {
      statusCode,
      body,
    });
  }

  exception(err, req = null) {
    this.log('error', 'exception', {
      message: err?.message || 'unknown error',
      stack: err?.stack || null,
      path: req?.originalUrl || null,
      method: req?.method || null,
      authorized: !!req?.headers?.authorization,
      reqBody: req?.body || null,
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
    if (body === undefined) return null;
    if (body === null) return null;
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }
    return body;
  }

  sanitize(logData) {
    const text = JSON.stringify(logData);

    return text
      .replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"*****"')
      .replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"*****"')
      .replace(/"apiKey"\s*:\s*"[^"]*"/gi, '"apiKey":"*****"')
      .replace(/"authorization"\s*:\s*"[^"]*"/gi, '"authorization":"*****"');
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