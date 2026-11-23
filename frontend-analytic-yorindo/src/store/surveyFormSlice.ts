import { createSlice } from "@reduxjs/toolkit"
import type { PayloadAction } from "@reduxjs/toolkit"
import type { SurveyForm, SurveyQuestion } from "@/types/survey-form"

interface CreateSurveyFormPayload {
  event_id: string
  title: string
  description?: string
  questions: SurveyQuestion[]
  link_survey?: string
  qr_code?: string
}

interface SurveyFormState {
  forms: SurveyForm[]
  isLoading: boolean
  selectedForm: SurveyForm | null
}

const initialState: SurveyFormState = {
  forms: [],
  isLoading: false,
  selectedForm: null,
}

const surveyFormSlice = createSlice({
  name: "surveyForms",
  initialState,
  reducers: {
    upsertForm: (state, action: PayloadAction<SurveyForm>) => {
      const index = state.forms.findIndex(
        (form) => form.form_id === action.payload.form_id
      )
      if (index === -1) {
        state.forms.push(action.payload)
      } else {
        state.forms[index] = action.payload
      }
    },
    addSurveyForm: (state, action: PayloadAction<CreateSurveyFormPayload>) => {
      const newForm: SurveyForm = {
        form_id: `SURVEY-FORM-${Date.now()}`,
        event_id: action.payload.event_id,
        title: action.payload.title,
        description: action.payload.description,
        questions: action.payload.questions,
        link_survey: action.payload.link_survey ?? "",
        qr_code: action.payload.qr_code ?? "",
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      state.forms.push(newForm)
    },
    updateSurveyForm: (
      state,
      action: PayloadAction<{ form_id: string; updates: Partial<SurveyForm> }>
    ) => {
      const index = state.forms.findIndex(
        (form) => form.form_id === action.payload.form_id
      )
      if (index !== -1) {
        state.forms[index] = {
          ...state.forms[index],
          ...action.payload.updates,
          updated_at: new Date().toISOString(),
        }
      }
    },
    deleteSurveyForm: (state, action: PayloadAction<string>) => {
      state.forms = state.forms.filter((form) => form.form_id !== action.payload)
    },
    setSelectedSurveyForm: (state, action: PayloadAction<SurveyForm | null>) => {
      state.selectedForm = action.payload
    },
  },
})

export const {
  upsertForm,
  addSurveyForm,
  updateSurveyForm,
  deleteSurveyForm,
  setSelectedSurveyForm,
} = surveyFormSlice.actions

export default surveyFormSlice.reducer
