import { NextResponse } from "next/server";
import { readDocumentLibrary } from "@/lib/document-library";

export async function GET() {
  const library = readDocumentLibrary();
  return NextResponse.json({ profileState: library.profileState, staleCount: library.staleCount });
}
