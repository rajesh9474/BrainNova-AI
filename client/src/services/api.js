import axios from 'axios';

const isLocal =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_URL ||
    (isLocal ? 'http://localhost:5000' : 'https://brainnova-ai.onrender.com'),
  timeout: 180000, // 3 minutes — AI processing takes time
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('brainnova_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('brainnova_token');
      localStorage.removeItem('brainnova_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
