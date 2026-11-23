import { useEffect, useState } from "react"
import { useDispatch, useSelector } from "react-redux"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, GripVertical, Plus, Trash2 } from "lucide-react"
import MainLayout from "@/components/Layout/MainLayout"
import Button from "@/components/Button"
import { api } from "@/services/api"
import { upsertForm } from "@/store/surveyFormSlice"
import type { RootState } from "@/store/store"
import type { SurveyForm, SurveyQuestion } from "@/types/survey-form"
import { getPublicSiteUrl } from "@/utils/publicSiteUrl"

interface NewQuestion {
  question: string
  type: SurveyQuestion["type"]
  required: boolean
  options?: string[]
}

interface BackendSurveyQuestion {
  questionId: string
  question: string
  type: string
  required: boolean
  order: number
  options?: Array<{ value: string; label: string }>
}

interface BackendSurvey {
  id: string
  eventId: string
  title: string
  description?: string | null
  questions: BackendSurveyQuestion[]
  createdAt?: string
  updatedAt?: string
}

const surveyLinkFor = (eventId: string) =>
  `${getPublicSiteUrl().replace(/\/+$/, "")}/feedback/${encodeURIComponent(eventId)}`

const mapBackendSurvey = (data: BackendSurvey): SurveyForm => ({
  form_id: data.id,
  event_id: data.eventId,
  title: data.title,
  description: data.description ?? undefined,
  questions: (data.questions ?? []).map((question) => ({
    id: question.questionId,
    question: question.question,
    type: question.type as SurveyQuestion["type"],
    required: Boolean(question.required),
    order: question.order,
    options: (question.options ?? []).map((option) => option.value),
  })),
  link_survey: surveyLinkFor(data.eventId),
  qr_code: "",
  is_active: true,
  created_at: data.createdAt ?? new Date().toISOString(),
  updated_at: data.updatedAt ?? new Date().toISOString(),
})

const SurveyFormPage = () => {
  const { eventId } = useParams<{ eventId: string }>()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { events } = useSelector((state: RootState) => state.events)
  const { forms } = useSelector((state: RootState) => state.surveyForms)
  const [formTitle, setFormTitle] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [questions, setQuestions] = useState<NewQuestion[]>([])
  const [newQuestion, setNewQuestion] = useState<NewQuestion>({
    question: "",
    type: "text",
    required: true,
  })
  const [showAddQuestion, setShowAddQuestion] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  const event = events.find((item) => item.event_id === eventId)
  const existingForm = forms.find((item) => item.event_id === eventId)

  useEffect(() => {
    if (!eventId) return

    let cancelled = false
    setIsLoading(true)

    api
      .get<BackendSurvey>(`/api/v1/surveys/event/${eventId}`)
      .then((result) => {
        if (cancelled || !result.data) return
        dispatch(upsertForm(mapBackendSurvey(result.data)))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [dispatch, eventId])

  const handleAddQuestion = () => {
    if (!newQuestion.question.trim()) return
    setQuestions((current) => [...current, newQuestion])
    setNewQuestion({ question: "", type: "text", required: true })
    setShowAddQuestion(false)
  }

  const handleSaveForm = async () => {
    if (!eventId || !event) return
    if (questions.length === 0) {
      setSaveError("Tambahkan minimal satu pertanyaan survey.")
      return
    }

    setIsSaving(true)
    setSaveError("")

    const payload = {
      eventId,
      title: formTitle.trim() || `Survey Feedback - ${event.title}`,
      description: formDescription.trim() || null,
      isPublished: true,
      questions: questions.map((question, index) => ({
        question: question.question.trim(),
        type: question.type,
        required: question.required,
        options:
          question.type === "select" || question.type === "radio"
            ? question.options ?? []
            : undefined,
        order: index + 1,
      })),
    }

    const result = await api.post<BackendSurvey>("/api/v1/surveys", payload)
    setIsSaving(false)

    if (result.error || !result.data) {
      setSaveError(result.message || "Gagal menyimpan survey.")
      return
    }

    dispatch(upsertForm(mapBackendSurvey(result.data)))
    navigate(`/events/${eventId}/analytics`)
  }

  if (!event) {
    return (
      <MainLayout title="Survey Form">
        <div className="card py-16 text-center">
          <p className="text-neutral-500">Event tidak ditemukan</p>
          <Button onClick={() => navigate("/events")} className="mt-4">
            Kembali ke Events
          </Button>
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout
      title="Survey Form"
      subtitle={`Event: ${event.title}`}
      actions={
        <Button variant="outline" onClick={() => navigate("/events")}>
          <ArrowLeft size={16} />
          Back
        </Button>
      }
    >
      <div className="mx-auto max-w-5xl">
        {isLoading ? (
          <div className="card py-16 text-center text-neutral-500">Memuat survey dari database...</div>
        ) : null}

        {!isLoading && existingForm ? (
          <div className="card space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{existingForm.title}</h2>
              <p className="mt-1 text-sm text-success">Survey form tersimpan di database.</p>
            </div>
            <div className="space-y-2">
              {existingForm.questions.map((question) => (
                <div key={question.id} className="flex items-center gap-3 rounded-card bg-neutral-50 p-3">
                  <GripVertical size={16} className="text-neutral-400" />
                  <div className="flex-1">
                    <p className="font-medium">{question.question}</p>
                    <p className="text-xs text-neutral-500">
                      Type: {question.type}
                      {question.required ? " • Required" : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!isLoading && !existingForm ? (
          <div className="card space-y-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-neutral-700">Form Title</label>
              <input
                value={formTitle}
                onChange={(event) => setFormTitle(event.target.value)}
                placeholder={`Survey Feedback - ${event.title}`}
                className="w-full rounded-button border border-neutral-300 px-4 py-3 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-neutral-700">Description</label>
              <textarea
                rows={3}
                value={formDescription}
                onChange={(event) => setFormDescription(event.target.value)}
                className="w-full rounded-button border border-neutral-300 px-4 py-3 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-neutral-900">Pertanyaan Survey</h3>
                  <p className="mt-1 text-sm text-neutral-500">
                    Tambahkan pertanyaan sesuai kebutuhan event ini.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowAddQuestion(true)}>
                  <Plus size={14} />
                  Add Question
                </Button>
              </div>

              {questions.length > 0 ? (
                <div className="mb-4 space-y-2">
                  {questions.map((question, index) => (
                    <div key={`${question.question}-${index}`} className="flex items-center gap-3 rounded-card bg-neutral-50 p-3">
                      <GripVertical size={16} className="text-neutral-400" />
                      <div className="flex-1">
                        <p className="font-medium">{question.question}</p>
                        <p className="text-xs text-neutral-500">
                          Type: {question.type}
                          {question.required ? " • Required" : ""}
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          setQuestions((current) =>
                            current.filter((_, currentIndex) => currentIndex !== index)
                          )
                        }
                        className="rounded-button p-2 text-danger transition hover:bg-danger/10"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-card border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
                  Belum ada pertanyaan. Tambahkan pertanyaan pertama di sini.
                </p>
              )}

              {showAddQuestion ? (
                <div className="space-y-3 rounded-card border border-neutral-200 p-4">
                  <input
                    value={newQuestion.question}
                    onChange={(event) =>
                      setNewQuestion((current) => ({
                        ...current,
                        question: event.target.value,
                      }))
                    }
                    placeholder="Masukkan pertanyaan"
                    className="w-full rounded-button border border-neutral-300 px-4 py-3 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <select
                    value={newQuestion.type}
                    onChange={(event) =>
                      setNewQuestion((current) => ({
                        ...current,
                        type: event.target.value as NewQuestion["type"],
                      }))
                    }
                    className="w-full rounded-button border border-neutral-300 px-4 py-3 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="text">Short Text</option>
                    <option value="textarea">Long Text</option>
                    <option value="select">Select</option>
                    <option value="radio">Radio</option>
                  </select>
                  {newQuestion.type === "select" || newQuestion.type === "radio" ? (
                    <input
                      placeholder="Option 1, Option 2"
                      onChange={(event) =>
                        setNewQuestion((current) => ({
                          ...current,
                          options: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        }))
                      }
                      className="w-full rounded-button border border-neutral-300 px-4 py-3 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  ) : null}
                  <label className="flex items-center gap-2 text-sm text-neutral-700">
                    <input
                      type="checkbox"
                      checked={newQuestion.required}
                      onChange={(event) =>
                        setNewQuestion((current) => ({
                          ...current,
                          required: event.target.checked,
                        }))
                      }
                    />
                    Required question
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleAddQuestion}>
                      Add Question
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowAddQuestion(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            {saveError ? <p className="text-sm text-danger">{saveError}</p> : null}

            <div className="flex gap-3 border-t border-neutral-100 pt-4">
              <Button onClick={handleSaveForm} disabled={isSaving}>
                {isSaving ? "Menyimpan..." : "Save Survey Form"}
              </Button>
              <Button variant="outline" onClick={() => navigate("/events")}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </MainLayout>
  )
}

export default SurveyFormPage
