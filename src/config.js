module.exports =  {
    // Your JWT secret can be any random string you would like. It just needs to be secret.
   jwtSecret: 'mycatiscute',
   db: {
   connection: {
      host: '127.0.0.1',
      user: 'root',
      password: 'greencouch',
      database: 'pizza',
      connectTimeout: 60000,
   },
   listPerPage: 10,
   },
   factory: {
   url: 'https://pizza-factory.cs329.click',
   apiKey: '208971a201ae4462b3d5bca3330f3e3c',
   },

metrics: {
  source: 'jwt-pizza-service-dev',
  endpointUrl: '',
  accountId: '',
  apiKey: '',
},
};