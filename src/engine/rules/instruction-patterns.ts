import { replaceLookalikeLetters } from "./payee-similarity";

// A closed, deterministic list of phrases that address the system instead of a person: orders to
// ignore the rules, to approve or not review the payment, words aimed at an AI and chat role markers.
// Urgency alone ("URGENTE", "pagar hoy", "pay immediately") is not here: it only counts together with
// an order to skip a control, and then the order is what matches. The list covers Spanish and English;
// spaced-out letters, leetspeak, other languages and paraphrases are left to human review.

export type InstructionPatternId =
  "OVERRIDE_RULES" | "APPROVE_COMMAND" | "NO_REVIEW" | "AI_ADDRESS" | "ROLE_MARKER";

export type InstructionMatch = { patternId: InstructionPatternId; match: string };

// Up to n words between the verb and its object: "ignore all previous instructions".
const upToWords = (n: number) => `(?:[\\p{L}\\p{N}]+ ){0,${n}}?`;

// Same, but none of the words in between may be one of the excluded ones: "without prior approval".
const upToWordsExcept = (n: number, excluded: readonly string[]) =>
  `(?:(?!(?:${excluded.join("|")}) )[\\p{L}\\p{N}]+ ){0,${n}}?`;

// "Returns are not accepted without prior approval" is an ordinary clause, not an order to the system.
// After a payment verb the exclusion does not apply: "pay without prior approval" is an order.
const TERMS_WORDS = ["prior", "previous", "written", "advance", "previa", "previo", "escrita"];

// Whole words only, on text reduced to lowercase words separated by single spaces.
const wordsPattern = (alternatives: readonly string[]) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "u");

const WORD_PATTERNS: readonly (readonly [InstructionPatternId, RegExp])[] = [
  [
    "OVERRIDE_RULES",
    wordsPattern([
      `(?:ignore|disregard|forget|override|bypass|skip) ${upToWords(3)}(?:instructions?|rules?|polic(?:y|ies)|checks|controls?|validations?|guidelines?|limits?|approvals?|reviews?|verifications?|safeguards?)`,
      `(?:ignora|ignoren|ignorar|omite|omita|omitan|omitir|olvida|olvide|olviden|olvidar|salta|salte|salten|saltar|saltate|desactiva|desactive|desactivar|anula|anule|anular) ${upToWords(3)}(?:instrucciones|instruccion|indicaciones|reglas?|politicas?|controles|control|validaciones|validacion|verificaciones|verificacion|limites|limite|aprobacion|aprobaciones|revision|revisiones)`,
      "(?:ignore|disregard|forget) (?:everything |all |the )?above",
      "(?:ignore|disregard|forget) (?:everything|anything) (?:before|previous|prior)",
      "(?:ignora|ignore|ignoren|ignorar|olvida|olvide|olvidar|omite|omita|omitir) (?:todo )?lo anterior",
    ]),
  ],
  [
    "APPROVE_COMMAND",
    wordsPattern([
      "(?:approve|authorize|authorise) (?:this|the) (?:payment|invoice|transfer|wire)s?",
      "(?:approve|authorize|authorise) (?:it|this|payments?)",
      "(?:apruebal|apruebel|autorizal|autoricel)(?:a|o|as|os)",
      "auto ?approved?",
      `mark ${upToWords(2)}as (?:paid|approved|verified|safe)`,
      "(?:aprueba|apruebe|aprueben|aprobar|autoriza|autorice|autoricen|autorizar) (?:este|esta|el|la|los|las) (?:pagos?|facturas?|transferencias?)",
      "(?:aprobar|apruebe|aprueba|autorizar|autorice|autoriza) automaticamente",
      "aprobacion automatica",
      `(?:marca|marque|marcar|marcala|marcarla|marquela) ${upToWords(2)}como (?:pagada|pagado|aprobada|aprobado|verificada|verificado)`,
    ]),
  ],
  [
    "NO_REVIEW",
    wordsPattern([
      `(?:without|skip|skipping|bypass|bypassing) ${upToWordsExcept(2, TERMS_WORDS)}(?:reviews?|reviewing|approvals?|approving|verifications?|verifying|checks|checking|controls|validations?|escalation|escalating)(?! (?:in advance|in writing))`,
      `(?:do not|don t|dont|never|no need to) ${upToWords(1)}(?:escalate|flag|block|review|verify|check)`,
      `(?:pay|release|transfer|wire|pagar|pague|paguen|paga|transferir|transfiera|liberar|libere) ${upToWords(3)}(?:without|sin) ${upToWords(2)}(?:reviews?|reviewing|approvals?|approving|verifications?|checks|checking|controls|validations?|revisar|revision|aprobacion|aprobar|verificar|verificacion|validar|validacion|controles|control)`,
      "(?:does not|doesn t|do not|don t) (?:need|require) (?:any |further |additional )?(?:review|approval|verification|escalation)",
      `(?:no|not) ${upToWords(1)}(?:review|approval|verification|escalation) (?:is )?(?:needed|required|necessary)`,
      `sin ${upToWordsExcept(2, TERMS_WORDS)}(?:revisar|revision|aprobacion|aprobar|verificar|verificacion|validar|validacion|escalar|consultar|controles|control)(?! (?:previa|previo|por escrito))`,
      "(?:no|nunca) (?:lo |la |le )?(?:escales|escale|escalen|escalar|frenes|frene|frenar|bloquees|bloquee|bloquear|revises|revise|revisar|verifiques|verifique|verificar)",
      "no (?:requiere|necesita|requieren|necesitan) (?:de )?(?:revision|aprobacion|verificacion|validacion)",
    ]),
  ],
  [
    "AI_ADDRESS",
    wordsPattern([
      "system prompt",
      "prompt injection",
      "(?:you are|you re|youre) (?:now )?(?:an? |the )?(?:ai|assistant|ai assistant|language model|llm|bot|chatbot|agent|model|gpt|claude)",
      "as an? (?:ai|language model|llm)",
      "act as (?:an? |the )?(?:ai|assistant|approver|administrator|admin)",
      "(?:new|updated) instructions?",
      "developer mode",
      "jailbreak",
      "(?:dear|attention|hey|hello|hi|note to the) (?:ai|llm|chatbot|ai assistant|ai agent)",
      "eres (?:un |una |el |la )?(?:ia|inteligencia artificial|asistente|agente|modelo|bot|chatbot|sistema)",
      "actua como (?:un |una |el |la )?(?:ia|asistente|aprobador|administrador|sistema)",
      "nuevas? instrucciones?",
      "instrucciones (?:del|para el|para la) (?:sistema|agente|asistente|modelo|ia)",
      "modo desarrollador",
      "(?:hola|atencion|querido|estimado|estimada|nota para la|nota para el) (?:ia|agente de ia|asistente de ia|inteligencia artificial)",
      "como (?:una |un )(?:ia|inteligencia artificial|modelo de lenguaje)",
    ]),
  ],
];

// Chat role markers are punctuation, so they are searched before punctuation becomes spaces. Spaces
// after a slash are only looked for when there is a slash: two optional runs of spaces in a row would
// make a "<" followed by 200,000 spaces take quadratic time. A role line may be quoted or formatted:
// "> System:", "- System:", "**System**:".
const ROLE_MARKER_PATTERN =
  /<\s*(?:\/\s*)?(?:system|assistant|user|instructions?|prompt)\s*>|<\|\s*(?:im_start|im_end|system|endoftext)\s*\|>|\[\s*(?:\/\s*)?(?:inst|system|sys)\s*\]|<<\s*(?:\/\s*)?sys\s*>>|^[ \t>#*\-\u2022]*(?:system|assistant)\**[ \t]*:/m;

// Format characters, Hangul fillers (letters that render as nothing) and control characters other
// than tabs and line breaks are removed, so they cannot split a word: "ign" + U+3164 + "ore".
const INVISIBLE_CHARACTERS =
  /[\p{Cf}\u115F\u1160\u3164\uFFA0\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F]/gu;

// Vertical tab, form feed and next line end a line, but JavaScript's "^" does not see them as line starts.
const LINE_SEPARATORS = /[\u000B\u000C\u0085]/g;

// Invisible characters, compatibility forms, case, accents and lookalike letters from other scripts
// never hide a phrase: a zero-width space inside a word, "aprobación" and a Cyrillic i read the same
// as plain Latin text. Invisible characters become the given replacement: nothing or a space.
function foldText(text: string, invisibleAs: "" | " "): string {
  return replaceLookalikeLetters(
    text
      .normalize("NFKC")
      .replace(LINE_SEPARATORS, "\n")
      .replace(INVISIBLE_CHARACTERS, invisibleAs)
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, ""),
  );
}

// Every run of symbols, punctuation or line breaks is one space: "ignore-the\nrules" -> "ignore the rules".
function toWords(folded: string): string {
  return folded.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// The first instruction to the system found in the text, or null. The match is quoted from the folded
// text, so it is lowercase and without accents. Invisible characters are tried both removed and as a
// space, so they can neither split a word ("ign" + U+200B + "ore") nor join two ("ignore" + U+200B +
// "the" + U+200B + "rules").
export function findInstruction(text: string): InstructionMatch | null {
  return findInFolded(foldText(text, "")) ?? findInFolded(foldText(text, " "));
}

function findInFolded(folded: string): InstructionMatch | null {
  const words = toWords(folded);
  for (const [patternId, pattern] of WORD_PATTERNS) {
    const found = pattern.exec(words);
    if (found !== null) return { patternId, match: found[0] };
  }
  const marker = ROLE_MARKER_PATTERN.exec(folded);
  return marker === null ? null : { patternId: "ROLE_MARKER", match: marker[0].trim() };
}
