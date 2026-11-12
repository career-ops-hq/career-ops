import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { noMarkdownImages } from "@/lib/markdown-options.mjs";

export default function AssistantMarkdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} {...noMarkdownImages}>{text}</ReactMarkdown>;
}
