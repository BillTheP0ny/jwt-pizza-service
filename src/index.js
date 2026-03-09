const config = require('./config.js');
const app = require('./app.js');

app.listen(config.port, () => {
  console.log(`jwt-pizza-service listening on port ${config.port}`);
  console.log(`jwt-pizza-service  connecting to db host ${config.db.connection.host}`);
  console.log(`jwt-pizza-service connecting to pizza factory ${config.factory.url}`);


});
