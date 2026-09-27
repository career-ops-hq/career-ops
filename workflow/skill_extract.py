"""Recognize the legacy hard-skill vocabulary and exact spelling aliases in Python."""

from __future__ import annotations

import re


SKILL_TOKENS = (
    "JavaScript", "TypeScript", "Python", "Ruby", "Java", "Golang", "Rust", "PHP", "Kotlin", "Swift", "Scala", "Elixir", "C\\+\\+", "C#", r"\.NET", "SQL",
    "React Native", "React", "Angular", r"Vue\.?js", "Svelte", r"Next\.?js", "Django", "Flask", "FastAPI", "Rails", "Laravel", "Symfony", "Spring", r"Node\.?js", "NodeJS",
    "MongoDB", "MySQL", "PostgreSQL", "Postgres", "Redis", "Elasticsearch", "Snowflake", "BigQuery", "Databricks", "DynamoDB", "Cassandra",
    "GraphQL", "gRPC", "Kafka", "RabbitMQ", "AWS", "GCP", "Azure", "Docker", "Kubernetes", "k8s", "Terraform", "Ansible", "Helm", "Jenkins",
    "GitHub Actions", "GitLab CI", "CI/CD", "Prometheus", "Grafana", "Datadog", "Supabase", "Inngest", "PyTorch", "TensorFlow", "scikit-learn", "Pandas", "NumPy",
    "Spark", "Airflow", "dbt", "MLOps", "MLflow", "LangChain", "LlamaIndex", "Hugging Face", "RAG", "LLMs?", "Prompt Engineering", "Fine-?tuning",
    "Computer Vision", "NLP", "Tableau", "Power BI", "Looker", "Salesforce", "SAP", "PMI-ACP", "PMI ACP", "PgMP", "CAPM", "PMBOK", "PMP", "PRINCE2", "PRINCE 2",
    "Certified Scrum Product Owner", "Certified ScrumMaster", "Certified Scrum Master", "CSPO", "ITIL", "COBIT", "TOGAF", "Lean Six Sigma", "Lean Six-Sigma", "Six Sigma", "Six-Sigma",
    "CISSP", "CISM", "CIPP",
)
SKILL_PATTERN = re.compile(r"(?<!\w)(?:" + "|".join(SKILL_TOKENS) + r")(?!\w)", re.I | re.ASCII)
GO_PATTERN = re.compile(r"(?<!\w)Go(?![\w-])", re.ASCII)
SAFE_PATTERN = re.compile(r"(?<!\w)SAFe(?!\w)", re.ASCII)
DISPLAY = {token.replace("\\", "").replace("?", "").lower(): token.replace("\\", "").replace("?", "") for token in SKILL_TOKENS}
ALIASES = {
    "k8s": "Kubernetes", "golang": "Go", "postgres": "PostgreSQL",
    "nodejs": "Node.js", "node.js": "Node.js", "nodejs.": "Node.js",
    "vuejs": "Vue.js", "vue.js": "Vue.js", "nextjs": "Next.js", "next.js": "Next.js",
    "llm": "LLMs", "llms": "LLMs", "finetuning": "Fine-tuning", "fine-tuning": "Fine-tuning",
    "power bi": "Power BI", "github actions": "GitHub Actions", "gitlab ci": "GitLab CI",
    "ci/cd": "CI/CD", "hugging face": "Hugging Face", "react native": "React Native",
    "prompt engineering": "Prompt Engineering", "computer vision": "Computer Vision",
    "scikit-learn": "scikit-learn", "c++": "C++", "c#": "C#", ".net": ".NET",
    "nlp": "NLP", "rag": "RAG", "sql": "SQL", "aws": "AWS", "gcp": "GCP",
    "grpc": "gRPC", "dbt": "dbt", "mlops": "MLOps", "mlflow": "MLflow",
    "pmp": "PMP", "pmi-acp": "PMI-ACP", "pgmp": "PgMP", "capm": "CAPM", "pmbok": "PMBOK",
    "prince2": "PRINCE2", "cspo": "CSPO", "certified scrummaster": "Certified ScrumMaster",
    "itil": "ITIL", "cobit": "COBIT", "togaf": "TOGAF", "lean six sigma": "Lean Six Sigma",
    "six sigma": "Six Sigma", "cissp": "CISSP", "cism": "CISM", "cipp": "CIPP",
    "certified scrum master": "Certified ScrumMaster", "certified scrum product owner": "CSPO",
    "pmi acp": "PMI-ACP", "prince 2": "PRINCE2", "lean six-sigma": "Lean Six Sigma",
    "six-sigma": "Six Sigma",
}


def canonicalize(token: str) -> str:
    """Only aliases for the same skill; unknown terms pass through unchanged."""
    key = token.lower()
    return ALIASES.get(key, DISPLAY.get(key, token))


def extract_skills(text: str) -> set[str]:
    if not text:
        return set()
    found = {canonicalize(match[0]) for match in SKILL_PATTERN.finditer(text)}
    if GO_PATTERN.search(text):
        found.add("Go")
    if SAFE_PATTERN.search(text):
        found.add("SAFe")
    return found
