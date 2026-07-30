import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      // replace — 만료 시점 딥링크 엔트리를 남기지 않는다(재로그인 후 뒤로가기 재진입 차단)
      window.location.replace('/')
    }
    return Promise.reject(err)
  }
)

export default api
