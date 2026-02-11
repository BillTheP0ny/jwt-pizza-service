const config = require('./config.js');
const app = require('./app.js');

app.listen(config.port, () => {
  console.log(`jwt-pizza-service listening on port ${config.port}`);
});
