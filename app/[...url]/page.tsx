import { ReaderShell } from "@/components/reader-shell";
import { ingestTarget, IngestError } from "@/lib/ingest";
import { normalizeTarget, TargetError } from "@/lib/target";

export const runtime = "nodejs";
export const maxDuration = 120;

type PageProps = {
  params: Promise<{ url: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function rebuildQuery(searchParams: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export default async function PrefixReaderPage({ params, searchParams }: PageProps) {
  const [{ url }, query] = await Promise.all([params, searchParams]);
  const rawTarget = `${url.join("/")}${rebuildQuery(query)}`;

  try {
    const targetUrl = normalizeTarget(rawTarget);
    const document = await ingestTarget(targetUrl);
    return <ReaderShell document={document} aiEnabled={process.env.MOIRE_QA_NO_AI !== "1"} />;
  } catch (error) {
    const message =
      error instanceof IngestError || error instanceof TargetError ? error.message : "This page could not be opened.";
    return (
      <main className="route-error-shell">
        <a className="wordmark" href="/">Moiré <span>β</span></a>
        <section className="route-error-card">
          <p>Source unavailable</p>
          <h1>{message}</h1>
          <a href="/">Try another page</a>
        </section>
      </main>
    );
  }
}
