import type { GenerateInput } from './provider';

// Prompt templates. Kept in one place so tone/behaviour is easy to tune.

const ANSWER_SYSTEM =
  'You help a job applicant answer application questions. Write in the first person ' +
  'as the applicant, using ONLY facts supported by the provided profile and documents. ' +
  'Never invent employers, dates, degrees, or achievements. Be specific, concise, and ' +
  'professional. If the profile lacks the information needed, write a reasonable, honest ' +
  'answer and avoid fabricating specifics. Return only the answer text — no preamble, ' +
  'no quotes, no markdown.';

const COVER_LETTER_SYSTEM =
  'You tailor a job applicant\'s base cover letter to a specific company and role. ' +
  'Keep the applicant\'s voice and any concrete facts. Personalise it to the company and ' +
  'role, fill in any bracketed placeholders using the profile, and keep it to 3–4 short ' +
  'paragraphs. Do not invent facts not supported by the profile. Return only the finished ' +
  'letter text — no preamble, no markdown.';

export function buildAnswerPrompt(question: string, context: string): GenerateInput {
  return {
    system: ANSWER_SYSTEM,
    prompt:
      `APPLICANT PROFILE:\n${context}\n\n` +
      `APPLICATION QUESTION:\n${question}\n\n` +
      `Write the applicant's answer:`,
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
  'Use the résumé\'s own wording. For "personal", use full URLs for linkedin/github/portfolio ' +
  'and split the name into first/last. Use "present" for current roles. Keep each description to ' +
  'one or two sentences. Use "" for any field not found and [] for absent sections. Do not invent ' +
  'anything.';

export function buildResumeParsePrompt(resumeText: string): GenerateInput {
  return {
    system: RESUME_PARSE_SYSTEM,
    maxOutputTokens: 2048,
    prompt: `RÉSUMÉ:\n${resumeText}\n\nReturn the JSON:`,
  };
}

export function buildCoverLetterPrompt(
  baseLetter: string,
  company: string,
  role: string,
  context: string,
): GenerateInput {
  return {
    system: COVER_LETTER_SYSTEM,
    prompt:
      `APPLICANT PROFILE:\n${context}\n\n` +
      `TARGET COMPANY: ${company || '(unknown)'}\n` +
      `TARGET ROLE: ${role || '(unknown)'}\n\n` +
      `BASE COVER LETTER (already has company/role/date substituted):\n${baseLetter}\n\n` +
      `Return the tailored cover letter:`,
  };
}
