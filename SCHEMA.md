# Question Bank Schema

This application natively supports importing questions formatted as **JSON**.

## LaTeX Support via KaTeX
Our engine automatically renders LaTeX mathematics explicitly matching two specified delimiter formats. 
- **Inline Math**: Use a single dollar sign `$`. Suitable for text-flows. 
  Example: `Calculate $x^2 + y$ knowing $\\lambda$.`
- **Block/Display Math**: Use double dollar signs `$$`. This centers the equation and allows multi-line fractions to map out beautifully. 
  Example: `$$\\int_0^{\\pi} \\sin x \\, dx = 2$$`

> **Note**: JSON formats require backslashes to be properly escaped string-side. Meaning a standard LaTeX expression like `\frac{a}{b}` must be written as `\\frac{a}{b}` within your JSON file!

## JSON Format

The JSON file must contain a single top-level array of objects.

### Object Properties

| Field | Type | Required | Description |
| ---- | ---- | -------- | ----------- |
| `id` | string | **Yes** | A unique identifier for the question (e.g. "chem-001"). Used for tracking progress and spaced repetition stability. |
| `subject` | string | **Yes** | The top-level category (e.g. "Chemistry HL"). Used for global grouping. |
| `topic` | string | **Yes** | The sub-category (e.g. "Organic Chemistry"). Used for "Topic Focus" mode. |
| `type` | string | **Yes** | Must be either `"flashcard"` or `"mcq"`. |
| `question` | string | **Yes** | The text of the question or the front of the flashcard. LaTeX supported. |
| `answer` | string | **Yes** | For `flashcard`: The back of the card. For `mcq`: The exact string of the correct option. LaTeX supported. |
| `options` | array | **Yes (if MCQ)** | An array of exactly 4 strings representing the multiple/choice options. The `answer` must be one of these strings. |
| `difficulty` | int | **Yes** | A number `1`, `2`, or `3` representing Easy, Medium, or Hard. |
| `explanation`| string | No | Optional explanation text shown after answering the question. LaTeX supported. |

### JSON Example
```json
[
  {
    "id": "chem-001",
    "subject": "Chemistry HL",
    "topic": "Thermodynamics",
    "type": "mcq",
    "question": "What relates Gibbs free energy to entropy?",
    "answer": "$$\\Delta G = \\Delta H - T\\Delta S$$",
    "options": [
      "$$\\Delta G = \\Delta H - T\\Delta S$$", 
      "$$\\Delta G = \\Delta H + T\\Delta S$$", 
      "$$\\Delta S = \\Delta H - T\\Delta G$$", 
      "$$\\Delta G = -RT \\ln K$$"
    ],
    "difficulty": 2,
    "explanation": "This relies on standard conditions."
  }
]
```

## Gamification & Arcade Keys
The application tracks progress using several additional properties in `localStorage`:

| Key | Type | Description |
| --- | --- | --- |
| `arcade_total_xp` | Integer | The global sum of all XP earned from sessions and speed runs. |
| `streak_count` | Integer | The current sequence of consecutive days studied. |
| `streak_last_date` | String | ISO Date (YYYY-MM-DD) of the last recorded streak event. |
| `streak_questions_today` | Integer | The number of questions answered successfully today. |
| `streak_questions_date` | String | Date string tracking today to trigger daily resets. |
| `mastered_topics` | Array | A JSON stringified array of topic names that have reached 100% mastery. |
| `heatmap_data` | Object | A JSON stringified dictionary mapping ISO dates to integer question counts. |
