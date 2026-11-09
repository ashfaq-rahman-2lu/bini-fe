import { useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, ApiError, jsonRequest } from './api'

type Kind = 'investment_confirm' | 'bank_confirm' | 'reconcile'
interface Job<T> {
  id: string; status: 'queued' | 'succeeded' | 'failed'; result: T | null;
  error: { status: number; detail: string } | null;
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function waitForJob<T>(id: string, signal?: AbortSignal): Promise<T> {
  let failures = 0, polls = 0
  for (;;) {
    signal?.throwIfAborted()
    let job: Job<T>
    try {
      job = await api<Job<T>>(`/jobs/${id}`, { signal })
      failures = 0
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) throw error
      if (++failures > 5) throw new Error('Connection interrupted. Your operation is saved. Refresh this page to check its result.')
      await pause(Math.min(failures * 1000, 5000))
      continue
    }
    if (job.status === 'succeeded') return job.result as T
    if (job.status === 'failed') throw new ApiError(job.error?.status || 500, job.error?.detail || 'Operation failed.')
    await pause(Math.min(1000 + polls++ * 250, 3000))
  }
}

// Recover queued work after a page refresh. A finished operation refreshes the
// current review instead of replaying an old cached financial snapshot.
export function useQueuedOperation<T, Context = undefined>(options: {
  kind: Kind; target?: string; parameters?: () => unknown;
  onMutate?: () => Context;
  onSuccess: (result: T, before: Context | undefined) => Promise<unknown> | unknown;
  onRecovered?: () => void;
  onError?: (error: Error) => void;
}) {
  const callbacks = useRef(options)
  callbacks.current = options
  const recovered = useRef('')
  const controller = useRef(new AbortController())
  const latest = useQuery({ queryKey: ['operation', options.kind, options.target],
    queryFn: () => api<Job<T> | null>(`/jobs?kind=${options.kind}${options.target ? `&target_id=${options.target}` : ''}`),
    enabled: options.kind === 'reconcile' || Boolean(options.target),
    refetchOnWindowFocus: false, retry: false, gcTime: 0,
  })
  const mutation = useMutation<T, Error, string | undefined, { before: Context | undefined; callbacks: typeof options; signal: AbortSignal }>({
    mutationFn: async resumeId => {
      const owner = callbacks.current, signal = controller.current.signal
      if (resumeId) return waitForJob<T>(resumeId, signal)
      let job = await api<Job<T>>('/jobs', { ...jsonRequest('POST', { kind: owner.kind, target_id: owner.target || null, parameters: owner.parameters?.() || {} }), signal })
      if (job.status === 'failed' && (job.error?.status || 0) >= 500) {
        job = await api<Job<T>>(`/jobs/${job.id}/retry`, { method: 'POST', signal })
      }
      return waitForJob<T>(job.id, signal)
    },
    onMutate: () => ({ before: callbacks.current.onMutate?.(), callbacks: callbacks.current, signal: controller.current.signal }),
    onSuccess: (result, _id, context) => { if (!context?.signal.aborted) return context?.callbacks.onSuccess(result, context.before) },
    onError: (error, _id, context) => { if (!context?.signal.aborted) context?.callbacks.onError?.(error) },
  })
  useEffect(() => {
    controller.current = new AbortController()
    recovered.current = ''
    mutation.reset()
    const current = controller.current
    // Stop browser polling on navigation, while the durable backend job remains
    // queued/running. A result for one import must never populate another page.
    return () => current.abort()
  }, [options.kind, options.target, mutation.reset])
  useEffect(() => {
    const job = latest.data
    if (!job || recovered.current === job.id || mutation.status !== 'idle') return
    recovered.current = job.id
    if (job.status === 'queued') mutation.mutate(job.id)
    else callbacks.current.onRecovered?.()
  }, [latest.data, mutation.status, mutation.mutate])
  return { ...mutation, isPending: mutation.isPending || latest.isPending,
    mutate: () => mutation.mutate(undefined), mutateAsync: () => mutation.mutateAsync(undefined),
    resume: (id: string) => mutation.mutate(id) }
}
