# Legal Disclaimer & Acceptable Use

## 1. Nature of the Project

`career-ops` is a collection of Markdown prompts, Node.js scripts, and HTML templates. It is strictly a local execution tool. The maintainers do not host, deploy, or operate an AI system, nor do we provide API access to Large Language Models (LLMs).

Users download the code, run it on their own machines, and connect it to their own AI provider (Anthropic, OpenAI, or any other). The maintainers have no visibility into, control over, or responsibility for how the tool is used after download.

## 2. Data Privacy (GDPR)

The maintainers do not act as a Data Controller or Data Processor under GDPR or any other data protection regulation.

- All Personal Identifiable Information (PII) you input — CVs, contact details, career history — is processed locally on your machine.
- When you use an AI CLI tool (Claude Code, Codex, OpenCode), your data is sent directly to the AI provider you chose. Review their privacy policies.
- We do not collect analytics, telemetry, or usage data of any kind.
- API keys, credentials, and personal files are gitignored by default. Never commit them to a public fork.

## 3. AI Model Behavior

This tool interfaces with AI models via third-party CLI tools. The maintainers do not control these models and cannot guarantee their behavior.

- **Hallucinations:** AI models may fabricate skills, job history, qualifications, or company information. You must manually verify all generated documents before submitting them to an employer.
- **Safety guardrails:** The default prompts instruct the AI never to auto-submit applications and to stop before the final send/apply action. However, AI compliance is not guaranteed. If you use different models, modify the system prompts, or override the safety instructions, you accept full responsibility for the AI's actions.
- **Evaluation accuracy:** Job offer scores and recommendations are AI-generated opinions based on pattern matching, not professional career advice. They should inform your judgment, not replace it.

## 4. Third-Party Platforms

career-ops interacts with career portals and job boards (Greenhouse, Lever, Ashby, Workday, and others).

- Users must comply with the Terms of Service of every platform they interact with.
- Do not use this tool to scrape platforms that prohibit automated access.
- Do not use this tool to spam employers, overwhelm ATS systems, or submit mass applications.
- Any consequences from ToS violations — including IP bans, account restrictions, or legal action from platforms — are solely the responsibility of the user.
- The maintainers actively reject contributions that facilitate ToS violations (see CONTRIBUTING.md).

## 5. Acceptable Use

career-ops is designed to help individuals make better career decisions, not to automate away human judgment. Acceptable use includes:

- Evaluating job offers to prioritize your time
- Generating tailored CVs that you review and edit before submitting
- Scanning public career pages for open positions
- Tracking your application pipeline

Unacceptable use includes:

- Auto-submitting applications without human review
- Scraping platforms that prohibit automated access
- Submitting AI-generated content without verifying its accuracy
- Using the tool to discriminate, deceive, or misrepresent qualifications

## 6. EU AI Act

Because this tool runs locally, is free, and is open-source, the maintainers are not placing an AI system on the market or putting one into service under the EU AI Act. Users who deploy the tool in a commercial or organizational context should assess their own obligations under the AI Act.

## 7. Indemnification

By using career-ops, you agree to indemnify, defend, and hold harmless the authors, contributors, and any affiliated parties from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising from your use of this software, your violation of these terms, or your violation of any third-party terms of service.

## 8. Cost Responsibility

If you use paid AI providers (Anthropic API, OpenAI API, etc.), you are solely responsible for monitoring and managing your own token usage and associated costs. The maintainers are not responsible for unexpected charges.

## 9. MIT License

As stated in the [LICENSE](LICENSE) file:

> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## 10. Trademark

The "career-ops" name and brand identity are separate from the MIT
license that governs the source code. The MIT license grants broad
rights to use, modify, and redistribute the code; it does not grant
rights to use the project name in commercial product naming,
endorsement claims, or affiliation messaging.

See [TRADEMARK.md](TRADEMARK.md) for permitted uses, restricted uses,
and how to request written permission for commercial naming or
endorsement.

## 11. Changes

This disclaimer may be updated as the project evolves. Users are encouraged to review it periodically.
