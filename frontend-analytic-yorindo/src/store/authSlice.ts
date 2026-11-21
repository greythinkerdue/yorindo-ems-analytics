import { createSlice } from "@reduxjs/toolkit"
import type { PayloadAction } from "@reduxjs/toolkit"
import type { User } from "@/types/user"

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}

/**
 * Redux auth adalah sisa demo lama dan TIDAK dipakai untuk mengunci halaman.
 * Sumber kebenaran login adalah AuthContext (OTP + JWT). Karena itu state
 * awalnya sengaja kosong agar tidak pernah memberi akses secara default.
 */
const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
}

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    login: (state, action: PayloadAction<User>) => {
      state.user = action.payload
      state.isAuthenticated = true
      localStorage.setItem("user", JSON.stringify(action.payload))
    },
    logout: (state) => {
      state.user = null
      state.isAuthenticated = false
      localStorage.removeItem("user")
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload
    },
    restoreUser: (state) => {
      const storedUser = localStorage.getItem("user")
      if (storedUser) {
        state.user = JSON.parse(storedUser) as User
        state.isAuthenticated = true
        return
      }

      state.user = null
      state.isAuthenticated = false
    },
  },
})

export const { login, logout, setLoading, restoreUser } = authSlice.actions
export default authSlice.reducer
