module.exports = {
  // ECS expects your container to listen on 80
  port: Number(process.env.PORT || 80),

  // use env var in ECS; fallback is only for local dev
  jwtSecret: process.env.JWT_SECRET || 'mycatiscute',

  db: {
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'greencouch',
      database: process.env.DB_NAME || 'pizza',
      connectTimeout: 60000,
    },
    listPerPage: 10,
  },

  factory: {
    url: process.env.FACTORY_URL || 'https://pizza-factory.cs329.click',
    apiKey: process.env.FACTORY_API_KEY || '208971a201ae4462b3d5bca3330f3e3c',
  },
};