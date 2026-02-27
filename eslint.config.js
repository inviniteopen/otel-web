import config from "@invinite/eslint-config/node";

export default [
  ...config,
  {
    languageOptions: {
      globals: {
        document: "readonly",
        fetch: "readonly",
        Headers: "readonly",
        location: "readonly",
        performance: "readonly",
        PerformanceObserver: "readonly",
        Request: "readonly",
        URL: "readonly",
        window: "readonly",
        XMLHttpRequest: "readonly",
      },
    },
  },
];
