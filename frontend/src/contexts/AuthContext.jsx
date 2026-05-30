import { createContext, useContext, useState, useEffect } from 'react'
import api from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children, isLoggedIn }) {
  const [role, setRole] = useState(null)
  const [menuPermissions, setMenuPermissions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isLoggedIn) {
      setRole(null)
      setMenuPermissions([])
      setLoading(false)
      return
    }
    api.get('/api/auth/me')
      .then(res => {
        setRole(res.data.role)
        setMenuPermissions(res.data.menu_permissions)
      })
      .catch(() => {
        setRole('user')
        setMenuPermissions([])
      })
      .finally(() => setLoading(false))
  }, [isLoggedIn])

  return (
    <AuthContext.Provider value={{ role, menuPermissions, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
