import type { GenerateInput } from './provider';

// Prompt templates. Kept in one place so tone/behaviour is easy to tune.

const ANSWER_SYSTEM =
  'You help a job applicant answer an open-ended application question. Write in the first ' +
  'person as the applicant. Ground every claim in the APPLICANT PROFILE, résumé, and ' +
  'documents provided, and tailor the answer to the specific JOB POSTING when one is given ' +
  '(reference the role, the company\'s needs, and the named tools/tech where they genuinely ' +
  'match the applicant\'s background). Be concrete: name real employers, projects, skills, ' +
  'and the actual tech stack from the profile — never answer with a single word or a vague ' +
  'platitude. Never invent employers, dates, degrees, numbers, or tools the profile does not ' +
  'support. Answer every part of the question. If the question asks for a length (e.g. "3–5 ' +
  'sentences"), honour it. If the profile genuinely lacks something, write an honest answer ' +
  'around what is known rather than fabricating. Return only the answer text — no preamble, ' +
  'no quotes, no markdown, no headings.';

const COVER_LETTER_SYSTEM =
  'You lightly tailor a job applicant\'s OWN cover-letter template. You MUST reproduce the ' +
  'template verbatim, character for character, EXCEPT: (1) rewrite ONLY the first body ' +
  'paragraph (the opening paragraph after the greeting) so it fits the target company, role, ' +
  'and job posting; (2) leave any {{company}}, {{role}}, {{date}} values that are already ' +
  'substituted in place. Do NOT change the greeting, the closing, the signature, the ' +
  'applicant\'s name, or any other paragraph — keep their exact wording, line breaks, and ' +
  'order. Keep the rewritten first paragraph in the applicant\'s voice and roughly the same ' +
  'length as the original. Do not invent facts not supported by the profile. Return only the ' +
  'finished letter text — no preamble, no markdown, no commentary.';

export function buildAnswerPrompt(
  question: string,
  context: string,
  jobText?: string,
): GenerateInput {
  const job = jobText?.trim()
    ? `JOB POSTING (tailor the answer to this role):\n${jobText.trim().slice(0, 8000)}\n\n`
    : '';
  return {
    system: ANSWER_SYSTEM,
    // Let the model think for higher-quality open-ended answers; give it a
    // generous budget so the thinking tokens AND the full answer both fit
    // (too small a cap truncates the answer to a word or two).
    thinking: true,
    maxOutputTokens: 8192,
    prompt:
      `APPLICANT PROFILE:\n${context}\n\n` +
      job +
      `APPLICATION QUESTION:\n${question}\n\n` +
      `Write the applicant's complete, concrete answer:`,
  };
}

const RESUME_PARSE_SYSTEM =
  'You extract structured data from a résumé. Return ONLY valid JSON (no markdown, no ' +
  'code fences, no commentary) matching exactly this shape:\n' +
  '{\n' +
  '  "personal": { "firstName": "", "lastName": "", "email": "", "phone": "", "city": "", ' +
  '"state": "", "country": "", "linkedin": "", "github": "", "portfolio": "" },\n' +
  '  "work": [{ "title": "", "company": "", "startDate": "", "endDate": "", "description": "" }],\n' +
  '  "education": [{ "school": "", "degree": "", "field": "", "graduationYear": "" }],\n' +
  '  "skills": ["", ""]\n' +
  '}\n' +
  'Use the résumé\'s own wording. For "personal", use the FULL URL for ' +
  'linkedin/github/portfolio (a "Links found in document:" section may list them — match each ' +
  'URL to the right field by its domain, e.g. linkedin.com → linkedin, github.com → github; any ' +
  'other personal site → portfolio). Never put the word "LinkedIn"/"GitHub" as the value — only a ' +
  'URL or "". Split the name into first/last. Use "present" for current roles. Keep each ' +
  'description to one or two sentences. Use "" for any field not found and [] for absent sections. ' +
  'Do not invent anything.';

export function buildResumeParsePrompt(resumeText: string): GenerateInput {
  return {
    system: RESUME_PARSE_SYSTEM,
    // Generous budget: 2.5 Flash spends "thinking" tokens before the JSON, so a
    // small cap truncates the output. JSON mode keeps the result parseable.
    maxOutputTokens: 8192,
    json: true,
    prompt: `RÉSUMÉ:\n${resumeText}\n\nReturn the JSON:`,
  };
}

const JOB_ELIGIBILITY_SYSTEM =
  'You read a job posting and report work-eligibility facts for a candidate who may ' +
  'need visa sponsorship. Return ONLY JSON (no markdown, no commentary) matching exactly:\n' +
  '{ "sponsorship": "available|none|unclear", "citizenship": "required|preferred|none", ' +
  '"clearance": "required|preferred|none", "experienceRequired": string|null, ' +
  '"experiencePreferred": string|null, "summary": string }\n' +
  'Base every field strictly on the posting. sponsorship="none" if the employer will not ' +
  'sponsor or candidates must be authorized to work without sponsorship; "available" if they ' +
  'will sponsor; else "unclear". citizenship/clearance: "required" vs "preferred" vs "none" per ' +
  'the wording. IGNORE the application form\'s screening questions (e.g. "Are you authorized to ' +
  'work…") — judge only the employer\'s stated requirements. experienceRequired/Preferred: years ' +
  'as a short string like "3+ years" or "2-4 years", else null. summary: one short sentence. ' +
  'Do not invent anything.';

export function buildJobEligibilityPrompt(jobText: string): GenerateInput {
  return {
    system: JOB_ELIGIBILITY_SYSTEM,
    json: true,
    maxOutputTokens: 512,
    prompt: `JOB POSTING:\n${jobText.slice(0, 12000)}\n\nReturn the JSON:`,
  };
}

export function buildCoverLetterPrompt(
  baseLetter: string,
  company: string,
  role: string,
  context: string,
  jobText?: string,
): GenerateInput {
  const job = jobText?.trim()
    ? `JOB POSTING (use only to shape the first paragraph):\n${jobText.trim().slice(0, 8000)}\n\n`
    : '';
  return {
    system: COVER_LETTER_SYSTEM,
    prompt:
      `APPLICANT PROFILE:\n${context}\n\n` +
      `TARGET COMPANY: ${company || '(unknown)'}\n` +
      `TARGET ROLE: ${role || '(unknown)'}\n\n` +
      job +
      `COVER-LETTER TEMPLATE (already has company/role/date substituted — reproduce it ` +
      `EXACTLY except rewrite only the first body paragraph):\n${baseLetter}\n\n` +
      `Return the template with only the first paragraph tailored:`,
  };
}
