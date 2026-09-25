import { useEffect, useState, type FormEvent } from "react";
import { getBuilderTemplates, type BuilderCreateInput, type BuilderTemplate } from "./api";
import { EmptyMessage, Icon } from "./components";
import { errorText } from "./domain";

interface Props {
  onCreate: (input: BuilderCreateInput) => Promise<void>;
  pending: boolean;
  serverError: string | null;
}

export default function AppBuilderPage({ onCreate, pending, serverError }: Props) {
  const [templates, setTemplates] = useState<BuilderTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getBuilderTemplates()
      .then((next) => {
        if (!active) return;
        setTemplates(next);
        setError(null);
        setTemplateId((current) => next.some((template) => template.id === current) ? current : "");
      })
      .catch((reason: unknown) => { if (active) setError(errorText(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    if (!templates.some((template) => template.id === templateId)) {
      setValidationError("Choose an available template.");
      return;
    }
    if (!title.trim() || !brief.trim()) {
      setValidationError("Add an app title and a product brief.");
      return;
    }
    void onCreate({ templateId, title: title.trim(), brief: brief.trim() });
  }

  return (
    <main className="main-panel builder-page" id="main-content">
      <div className="page-topline"><div><p className="eyebrow">App builder</p><h1>Start with the work, then build.</h1><p className="page-lede">Choose a template and describe the product. The local factory records a WorkOrder and prepares scaffold artifacts for review.</p></div></div>
      <div className="builder-intro"><span className="builder-intro__mark"><Icon name="sparkle" size={20} /></span><div><strong>What this prepares</strong><p>A WorkOrder, a selected template version, and local scaffold files. You can start a local preview from the WorkOrder after it is created.</p></div></div>
      <form className="builder-form" onSubmit={submit}>
        <section className="paper-card builder-form__main" aria-labelledby="builder-brief-title"><div className="card-heading"><p className="eyebrow">01 · Product brief</p><h2 id="builder-brief-title">Describe the app</h2></div><div className="field"><label htmlFor="builder-title">App title <span aria-hidden="true">*</span></label><input id="builder-title" required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="A concise name for the work" /></div><div className="field"><label htmlFor="builder-brief">Product brief <span aria-hidden="true">*</span></label><textarea id="builder-brief" required rows={9} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Who is this for, what should it do, and how will you know it works?" /><p className="field-help">State the user problem, core flow, and constraints. The WorkOrder will preserve this original request.</p></div></section>
        <section className="paper-card builder-form__templates" aria-labelledby="builder-template-title"><div className="card-heading"><p className="eyebrow">02 · Starting point</p><h2 id="builder-template-title">Choose a template</h2></div>
          {loading && templates.length === 0 ? <div className="builder-templates__loading" role="status">Loading available templates…</div> : error && templates.length === 0 ? <div className="builder-templates__error" role="alert"><p>{error}</p><button className="button button--quiet" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></div> : templates.length === 0 ? <EmptyMessage title="No templates available" description="The local service has not provided an App builder template yet." /> : <div className="builder-template-list" role="radiogroup" aria-label="App templates">{templates.map((template) => <label className={template.id === templateId ? "builder-template builder-template--selected" : "builder-template"} key={template.id}><input type="radio" name="builder-template" value={template.id} checked={template.id === templateId} onChange={() => setTemplateId(template.id)} required /><span><strong>{template.name}</strong><small>Version {template.version}</small><span>{template.description}</span></span></label>)}</div>}
          {error && templates.length > 0 && <p className="builder-templates__stale" role="alert">Templates could not refresh: {error}</p>}
        </section>
        {(validationError || serverError) && <div className="form-error builder-form__error" role="alert">{validationError || serverError}</div>}
        <div className="builder-form__actions"><p>Review the created WorkOrder and local artifacts before starting an attempt.</p><button className="button button--primary" type="submit" disabled={pending || loading || templates.length === 0}>{pending ? "Preparing…" : "Prepare app scaffold"}<Icon name="arrow" size={17} /></button></div>
      </form>
    </main>
  );
}
