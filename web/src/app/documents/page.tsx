"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileText, File, Calendar, Loader2 } from "lucide-react";
import { documentDisplayTitle } from "@/lib/document-title.mjs";

type DocumentItem = {
  id: string;
  filename: string;
  kind: "cv" | "cover" | "unknown";
  company?: string;
  role?: string;
  date: string | null;
  reportId: string | null;
  format: string | null;
  mtimeMs: number;
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    fetch("/api/documents")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load documents");
        return res.json();
      })
      .then((data) => {
        setDocuments(data);
        setError(null);
      })
      .catch((err) => {
        setError(err.message || "Something went wrong");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    refetch();

    window.addEventListener("co-job-done", refetch);

    return () => {
      window.removeEventListener("co-job-done", refetch);
    };
  }, [refetch]);


  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 rounded-full bg-red-500/10 p-3 text-red-500">
          <File className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-medium text-foreground">Failed to load</h2>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Documents
          </h1>
          <p className="mt-1 text-sm text-muted">
            Browse your generated CVs and cover letters.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="mb-4 rounded-full bg-surface-hover p-3 text-muted">
            <FileText className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-medium text-foreground">No documents found</h2>
          <p className="mt-1 max-w-md text-sm text-muted">
            Open a report and choose Generate tailored CV (PDF). The file shows up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Documents
        </h1>
        <p className="mt-1 text-sm text-muted">
          Browse your generated CVs and cover letters.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {documents.map((doc) => {
          const display = documentDisplayTitle(doc);
          return (
          <Card key={doc.id} className="flex flex-col justify-between p-4">
            <div>
              <div className="flex items-start justify-between">
                <div className="flex min-w-0 items-center space-x-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-brand/10 text-brand-text">
                    {doc.kind === "cv" ? (
                      <FileText className="h-4 w-4" />
                    ) : (
                      <File className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-medium text-foreground line-clamp-2" title={display.title}>
                      {display.title}
                    </h3>
                    <p className="truncate text-xs text-muted" title={display.filename}>{display.filename}</p>
                  </div>
                </div>
              </div>
              
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone="info" className="capitalize">
                  {doc.kind === "cv" ? "CV" : doc.kind === "cover" ? "Cover Letter" : "Document"}
                </Badge>
                {doc.date && (
                  <Badge tone="muted" className="flex items-center gap-1 font-normal">
                    <Calendar className="h-3 w-3" />
                    {doc.date}
                  </Badge>
                )}
                {doc.format && (
                  <Badge tone="muted" className="uppercase font-normal">
                    {doc.format}
                  </Badge>
                )}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-border">
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => window.open(`/api/documents?id=${doc.id}`, "_blank")}
              >
                Open PDF
                <ExternalLink className="h-4 w-4 text-muted" />
              </Button>
            </div>
          </Card>
          );
        })}
      </div>
    </div>
  );
}
