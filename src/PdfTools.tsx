import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Download, FileText, LoaderCircle, UnlockKeyhole, UploadCloud, X } from 'lucide-react'
import { api, unlockPdf, type ImportReview, type ImportSummary } from './api'

const maxBytes = 10 * 1024 * 1024
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Please try again.' }
function ErrorBox({ message }: { message: string }) { return message ? <div role="alert" className="error-box">{message}</div> : null }

export function UnlockPdf() {
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState('')
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url) }, [download])
  const mutation = useMutation({ gcTime: 0,
    mutationFn: async (data: FormData) => {
      controller.current = new AbortController()
      const blob = await unlockPdf(data, controller.current.signal)
      if (controller.current.signal.aborted) return
      const name = (data.get('file') as File).name.replace(/\.pdf$/i, '') + '_unlocked.pdf'
      setDownload({ url: URL.createObjectURL(blob), name })
    },
    onSettled: (_data, _error, variables) => { variables.delete('password'); setPassword('') },
  })
  function submit(event: FormEvent) {
    event.preventDefault(); setLocalError(''); setDownload(null)
    if (!file) { setLocalError('Choose a PDF first.'); return }
    if (file.size > maxBytes) { setLocalError('PDF must be at most 10 MB.'); return }
    const data = new FormData(); data.append('file', file); data.append('password', password)
    mutation.mutate(data)
  }
  return <>
    <header className="page-header"><div><div className="eyebrow">PDF TOOLS</div><h1>Unlock a PDF</h1><p>Remove password protection and save a copy to your computer.</p></div></header>
    <div className="upload-layout"><section className="panel upload-panel"><form onSubmit={submit}>
      <label className={`drop-zone ${file ? 'has-file' : ''}`}><UnlockKeyhole size={34} strokeWidth={1.4} /><strong>{file?.name || 'Choose a password-protected PDF'}</strong><span>PDF · Up to 10 MB · 50 pages</span><input aria-label="PDF to unlock" type="file" accept="application/pdf,.pdf" disabled={mutation.isPending} onChange={e => { setFile(e.target.files?.[0] || null); setPassword(''); setDownload(null); setLocalError(''); mutation.reset() }} /></label>
      <label className="password-label"><span>PDF password</span><input aria-label="PDF password" type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} disabled={mutation.isPending} placeholder="Enter the PDF password" /><small>Leave blank if the PDF opens without a password.</small></label>
      <ErrorBox message={localError || (mutation.error ? errorMessage(mutation.error) : '')} />
      <button className="primary-button wide" disabled={mutation.isPending || !file}>{mutation.isPending ? <><LoaderCircle size={17} className="animate-spin" /> Unlocking PDF…</> : <><UnlockKeyhole size={17} /> Unlock PDF</>}</button>
    </form>
    {download && <div className="download-ready" role="status"><CheckCircle2 size={21} /><div><strong>Your unlocked copy is ready.</strong><p>Save it using your browser’s download settings.</p><a className="secondary-button" href={download.url} download={download.name}><Download size={16} /> Download unlocked PDF</a></div></div>}
    </section><aside className="import-info"><div className="eyebrow">SAVE A LOCAL COPY</div><h2>Open it easily<br />next time.</h2><p>The password and unlocked copy are processed in memory and are not saved to the application database. Click Download to save the copy to your computer; your browser controls the destination folder.</p><p className="support-note">This tool works with PDFs from any bank. To add transactions to your ledger, use <Link to="/imports/new">Import statements →</Link>.</p></aside></div>
  </>
}

type Selection = {
  key: string; name: string; file: File | null; password: string;
  state: 'waiting' | 'processing' | 'ready' | 'failed'; error?: string;
  result?: { id: string; status: string; canConfirm: boolean };
}

export function StatementUpload() {
  const [files, setFiles] = useState<Selection[]>([])
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState('')
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const navigate = useNavigate()
  const client = useQueryClient()
  const recent = useQuery({ queryKey: ['imports'], queryFn: () => api<ImportSummary[]>('/imports') })
  useEffect(() => () => controller.current?.abort(), [])
  function update(key: string, values: Partial<Selection>) { setFiles(previous => previous.map(item => item.key === key ? { ...item, ...values } : item)) }
  async function submit(event: FormEvent) {
    event.preventDefault(); setLocalError('')
    if (!files.length || files.length > 20) { setLocalError('Select between 1 and 20 PDFs.'); return }
    const pending = files.filter(item => item.file && item.state !== 'ready').map(item => ({ ...item, secret: item.password || password }))
    setPassword(''); setFiles(previous => previous.map(item => ({ ...item, password: '' })))
    controller.current = new AbortController()
    const signal = controller.current.signal
    setBusy(true)
    try {
      for (const item of pending) {
        if (signal.aborted) break
        update(item.key, { state: 'processing', error: undefined })
        const data = new FormData()
        try {
          if (item.file!.size > maxBytes) throw new Error('PDF must be at most 10 MB.')
          data.append('file', item.file!); data.append('password', item.secret)
          const result = await api<ImportReview>('/imports', { method: 'POST', body: data, signal })
          update(item.key, { state: 'ready', file: null, result: { id: result.id, status: result.status, canConfirm: result.can_confirm } })
          client.setQueryData(['import', result.id], result)
          await client.invalidateQueries({ queryKey: ['imports'] })
          if (files.length === 1) navigate('/imports/' + result.id)
        } catch (error) {
          if (signal.aborted) break
          update(item.key, { state: 'failed', error: errorMessage(error) })
        } finally {
          data.delete('password'); item.secret = ''; item.password = ''
        }
      }
    } finally {
      // Navigation can stop the queue before all its entries have been attempted.
      pending.forEach(item => { item.secret = ''; item.password = '' })
      setBusy(false)
    }
  }
  const multiple = files.length > 1
  const failed = files.some(item => item.state === 'failed')
  const remaining = files.filter(item => item.file && item.state !== 'ready').length
  return <>
    <header className="page-header"><div><div className="eyebrow">BRING YOUR STATEMENTS TOGETHER</div><h1>Import statements</h1><p>Upload together. Review and confirm each statement.</p></div><Link className="secondary-button" to="/pdf-unlock"><UnlockKeyhole size={16} /> Unlock a PDF</Link></header>
    <div className="upload-layout"><section className="panel upload-panel"><div className="step-label"><span>1</span> Upload <ArrowRight size={15} /><span className="inactive">2</span> Review <ArrowRight size={15} /><span className="inactive">3</span> Confirm</div>
      <form onSubmit={submit}>
        <label className={`drop-zone ${files.length ? 'has-file' : ''}`}><UploadCloud size={34} strokeWidth={1.4} /><strong>{multiple ? `${files.length} statements selected` : files[0]?.name || 'Choose your bank statements'}</strong><span>Select one or more EBL PDFs from your device</span><span className="file-limit">Up to 20 PDFs · 10 MB and 50 pages per PDF</span><input aria-label="PDF statement" type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={e => { setFiles(Array.from(e.target.files || []).map(file => ({ key: crypto.randomUUID(), name: file.name, file, password: '', state: 'waiting' }))); setLocalError(''); setPassword('') }} /></label>
        <label className="password-label"><span>{multiple ? 'Shared PDF password' : 'PDF password'}</span><input aria-label="PDF password" aria-describedby="password-help" type="password" autoComplete="off" placeholder="Leave blank for unlocked PDFs" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /><small id="password-help">{multiple ? 'Used for every PDF unless you enter an individual password below. ' : ''}Passwords are never saved and are cleared after submission.</small></label>
        {multiple && <div className="batch-files" aria-label="Selected statements">{files.map((item, index) => <div className="batch-file" key={item.key}>
          <div className="batch-file-heading"><FileText size={17} /><strong>{item.name}</strong>{!busy && <button type="button" className="icon-button" aria-label={`Remove statement ${index + 1}`} onClick={() => setFiles(previous => previous.filter(file => file.key !== item.key))}><X size={14} /></button>}</div>
          {item.state === 'waiting' || item.state === 'failed' ? <label><span>Individual password (optional)</span><input aria-label={`Password for statement ${index + 1}`} type="password" autoComplete="off" placeholder="Use shared password" value={item.password} disabled={busy} onChange={e => update(item.key, { password: e.target.value })} /></label> : null}
          <div className="batch-state" role="status">{item.state === 'processing' ? <><LoaderCircle size={14} className="animate-spin" /> Reading and checking…</> : item.state === 'ready' ? <><CheckCircle2 size={14} />{item.result?.status === 'confirmed' ? 'Already confirmed' : item.result?.canConfirm ? 'Ready for review' : 'Review checks before confirming'}</> : item.state === 'failed' ? 'Could not process this PDF' : 'Waiting to upload'}</div>
          {item.error && <ErrorBox message={item.error} />}{item.result && <Link className="secondary-button" to={'/imports/' + item.result.id}>Review statement {index + 1} <ArrowRight size={14} /></Link>}
        </div>)}</div>}
        {!multiple && files[0]?.error && <ErrorBox message={files[0].error} />}<ErrorBox message={localError} />
        <button className="primary-button wide" type="submit" disabled={busy || !remaining || files.length > 20}>{busy ? <><LoaderCircle size={17} className="animate-spin" /> Processing statements…</> : <>{!remaining ? 'Upload complete' : failed && multiple ? 'Retry failed statements' : multiple ? `Process ${remaining} statements` : 'Continue to review'} <ArrowRight size={17} /></>}</button>
        {files.length > 20 && <ErrorBox message="Select at most 20 PDFs at a time." />}
        {busy && <p className="footnote">Keep this page open until processing finishes. Each successful statement is saved as a separate draft.</p>}
      </form>
    </section><aside className="import-info"><div className="eyebrow">WHAT HAPPENS NEXT</div><h2>A careful import,<br />every time.</h2><p>Each PDF is checked individually. A failed file does not stop the others. Review each draft before confirming; overlaps are checked again against the latest ledger when you open the review.</p><p className="support-note">Supports EBL statements in BDT. Unlocking is optional: you can import protected PDFs directly, or select copies you previously saved using the unlock tool.</p></aside></div>
    <section className="panel recent-imports"><div className="section-heading"><h2>Recent imports</h2><span className="subtle">Latest 50 · saved drafts and confirmed statements</span></div>
      {recent.error && <ErrorBox message={errorMessage(recent.error)} />}{recent.isPending && <p className="recent-empty">Loading saved imports…</p>}
      {recent.data?.length === 0 && <p className="recent-empty">Your uploaded statements will appear here so you can return to their reviews.</p>}
      {recent.data?.map(item => <Link className="recent-import" to={'/imports/' + item.id} key={item.id}><FileText size={17} /><span><strong>{item.filename}</strong><small>{item.status === 'draft' ? 'Draft · review required' : 'Confirmed'} · {new Date(item.created_at).toLocaleString()}</small></span><ArrowRight size={16} /></Link>)}
    </section>
  </>
}
