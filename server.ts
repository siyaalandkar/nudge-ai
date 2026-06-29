import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const apiKey = process.env.GEMINI_API_KEY;
  const ai = apiKey
    ? new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      })
    : null;

  if (!ai) {
    console.warn("Warning: GEMINI_API_KEY environment variable is not set. Running in offline/cozy fallback mode.");
  }

  // --- API Endpoints ---

  // 0. Smart Daily Briefing
  app.post("/api/daily-briefing", async (req, res) => {
    try {
      const { tasks, profileName, userType, localHour } = req.body;
      const userName = profileName || "Explorer";
      const pendingTasks = (tasks || []).filter((t: any) => !t.completed);

      const hour = (localHour !== undefined && localHour !== null) ? Number(localHour) : new Date().getHours();
      let timeOfDay = "morning";
      let timeIcon = "☀️";
      if (hour >= 12 && hour < 17) {
        timeOfDay = "afternoon";
        timeIcon = "🌤️";
      } else if (hour >= 17 || hour < 5) {
        timeOfDay = "evening";
        timeIcon = "🌙";
      }

      const getFallbackResult = () => {
        const greeting = `Good ${timeOfDay}, ${userName}! ${timeIcon}`;
        let summary = "Welcome to a fresh day of quests! ";
        if (pendingTasks.length === 0) {
          summary += "Your daily checklist is clean and ready. Add some cozy quests to start your day! ✦";
        } else {
          summary += `You have ${pendingTasks.length} daily quest${pendingTasks.length > 1 ? "s" : ""} waiting for your magic touch. ✨`;
        }
        
        const now = Date.now();
        const urgentTasks = pendingTasks.filter((t: any) => {
          if (!t.deadline) return false;
          const diff = new Date(t.deadline).getTime() - now;
          return diff > 0 && diff < 24 * 60 * 60 * 1000;
        });

        const overdueTasks = pendingTasks.filter((t: any) => {
          if (!t.deadline) return false;
          return new Date(t.deadline).getTime() < now;
        });

        let warnings = "";
        if (overdueTasks.length > 0) {
          warnings = `⚠️ Heads up! You have ${overdueTasks.length} overdue quest${overdueTasks.length > 1 ? "s" : ""} that need your attention.`;
        } else if (urgentTasks.length > 0) {
          warnings = `⏰ Gentle nudge: "${urgentTasks[0].title}" is due soon today.`;
        } else {
          warnings = "No urgent deadline warnings. Breathe easy and enjoy your pace! 🍀";
        }

        const motivation = "Remember, progress is not about speed; it's about the direction of your heart. ☕🌸";

        return { greeting, summary, warnings, motivation };
      };

      if (!ai) {
        return res.json(getFallbackResult());
      }

      const tasksSummary = pendingTasks
        .map(
          (t: any) =>
            `- "${t.title}" | Category: ${t.category} | Priority: ${t.priority} | Due: ${t.deadline || "No deadline"}`
        )
        .join("\n");

      const isStudent = userType === "Student";
      const toneInstruction = isStudent
        ? "Tone: Cozy, warm, encouraging student vibe. Reference studies, coursework, exams, cozy study corners, or learning milestones."
        : "Tone: Supportive, professional yet cozy work vibe. Reference client calls, project deliverables, meetings, personal career goals, or productivity.";

      const prompt = `You are "Nudge AI", a warm, supportive digital planner buddy.
We want to generate a cozy, cute, personalized Smart Daily Briefing for our user named "${userName}".
The current local time of the user is ${timeOfDay} (hour ${hour}). Please make sure to greet them for this specific time of day.

${toneInstruction}

Here is their list of pending tasks:
${tasksSummary || "No pending tasks."}

Please generate the following fields:
1. "greeting": A warm, personalized greeting for this ${timeOfDay} using the user's name (e.g., "Good ${timeOfDay}, ${userName}! ${timeIcon}" or "Rise and shine, ${userName}! ✦")
2. "summary": A brief, comforting 1-2 sentence AI summary of their tasks for today.
3. "warnings": A clear deadline warning if they have any overdue tasks or tasks due today (within 24 hours), or a friendly "all-clear" message if no urgent deadlines exist.
4. "motivation": One short, heartwarming motivational nudge (under 15 words) with 1-2 cute emojis.

Please respond strictly in JSON with this format:
{
  "greeting": "...",
  "summary": "...",
  "warnings": "...",
  "motivation": "..."
}`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                greeting: { type: Type.STRING },
                summary: { type: Type.STRING },
                warnings: { type: Type.STRING },
                motivation: { type: Type.STRING }
              },
              required: ["greeting", "summary", "warnings", "motivation"]
            }
          }
        });

        const data = JSON.parse(response.text || "{}");
        res.json(data);
      } catch (geminiError: any) {
        console.warn("Gemini daily-briefing failed, using fallback:", geminiError);
        res.json(getFallbackResult());
      }
    } catch (error: any) {
      console.error("Daily briefing error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // 1. Generate Daily Action Plan
  app.post("/api/action-plan", async (req, res) => {
    try {
      const { tasks, profileName, userType } = req.body;
      if (!tasks || !Array.isArray(tasks)) {
        return res.status(400).json({ error: "Tasks must be an array" });
      }

      const name = profileName || "there";

      if (!ai) {
        return res.json({
          plan: `Good morning, ${name}! ☀️ Here's your day! ✦ You have ` + 
            tasks.filter(t => !t.completed).length + " active quests waiting for you. " +
            "How about we pick one single tiny step and make a cozy, beautiful start today? You can do this! ✦☕"
        });
      }

      const tasksSummary = tasks
        .map(
          (t, i) =>
            `${i + 1}. [${t.completed ? "Completed" : "Pending"}] ${t.title} | Category: ${t.category} | Priority: ${t.priority} | Due: ${t.deadline} | Notes: ${t.notes || "None"}`
        )
        .join("\n");

      const isStudent = userType === "Student";
      const toneInstruction = isStudent
        ? "Tone: Cozy, warm, encouraging student vibe. Reference studies, homework, exams, cozy campus corners, or lecture blocks."
        : "Tone: Supportive, professional yet cozy work vibe. Reference client deliveries, team syncs, meetings, and balance with personal me-time.";

      const prompt = `You are "Nudge AI", a warm, encouraging, and cheerful digital planner coach.
Your tone is soft, playful, cozy, and highly motivating. Use plenty of cute emojis (e.g., ✦, ✨, ☕, 🚀, ✍️, ❤️).

${toneInstruction}

The user's name is "${name}". You MUST address the user personally as "${name}".
Always start with a beautiful personalized greeting, for example: "Good morning, ${name}! ☀️ Here's your day" or "Hey ${name}! Let's make today beautiful. ✦"

Here is ${name}'s current task list:
${tasksSummary || "No tasks added yet! It is a clean slate."}

Please generate a personalized, friendly daily action plan in bullet points with emoji. 
- Highlight any urgent tasks (due today, overdue, or due soon).
- Include brief daily sections like "Morning Momentum ✦", "Afternoon Flow ☕", and "Cozy Nudges ✦".
- Give a gentle, supportive word of motivation for things with tight deadlines.
- Keep the language cozy, inspiring, and concise (under 200 words). Do not use aggressive corporate speak.`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
        });
        res.json({ plan: response.text });
      } catch (geminiError: any) {
        console.warn("Gemini action plan generation failed, using fallback:", geminiError);
        const pendingCount = tasks.filter(t => !t.completed).length;
        res.json({
          plan: `Good morning, ${name}! ☀️ Here's your cozy day! ✦\n\n### Morning Momentum ✦\n- Check your task list! You have **${pendingCount} pending quests** waiting for you. ☕\n\n### Afternoon Flow ☕\n- Focus on your highest priority task and take a steady, quiet step forward. 🌿\n\n### Cozy Nudges ✦\n- Remember to take lovely deep breaths and stretch your hands. You've got this! ✨`
        });
      }
    } catch (error: any) {
      console.error("Action plan error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // 2. Chat Assistant
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, tasks, profileName, userType } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const name = profileName || "friend";

      if (!ai) {
        return res.json({
          reply: `Hey, ${name}! I'm Nudge Buddy. I'm currently running in offline-cozy mode, but you are doing an absolutely stellar job! Let's handle your checklist one doodle at a time. What are we starting first? ✦`
        });
      }

      const tasksSummary = (tasks || [])
        .map(
          (t: any, i: number) =>
            `${i + 1}. [${t.completed ? "Completed" : "Pending"}] ${t.title} | Category: ${t.category} | Priority: ${t.priority} | Due: ${t.deadline}`
        )
        .join("\n");

      const isStudent = userType === "Student";
      const toneInstruction = isStudent
        ? "Tone: Cozy, warm, encouraging student vibe. Reference studies, lectures, coursework, exams, homework, cozy campus life, or study breaks."
        : "Tone: Supportive, professional yet cozy work vibe. Reference meetings, deadlines, milestones, work-life balance, client followups, or career objectives.";

      const prompt = `You are "Nudge AI", a friendly, empathetic digital planner assistant.
Your style is cheerful, warm, and motivating, with adorable emojis.
The user's name is "${name}". You MUST address them personally as "${name}".
You answer user questions about their schedule, habits, and productivity in a warm, conversational tone.

${toneInstruction}

Here is the user's current task list to give you context:
${tasksSummary || "No tasks in the planner yet!"}

User's query: "${message}"

Please respond warmly, keeping it concise, cozy, and actionable. Encompass their list context if they ask about what is next, what is due, or what they should focus on. Use formatting like ✦ or * for bullets.`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
        });
        res.json({ reply: response.text });
      } catch (geminiError: any) {
        console.warn("Gemini chat failed, using fallback:", geminiError);
        res.json({
          reply: `Hey, ${name}! I'm right here in your cozy corner. 🌸 Even if our AI dreamlands are briefly a bit misty, I can see your quests and I'm cheering you on! Let's focus on tackling one small thing at a time. What's on your mind? ✦`
        });
      }
    } catch (error: any) {
      console.error("Chat error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // 3. Analyze Task Urgency and Nudge
  app.post("/api/analyze-task", async (req, res) => {
    try {
      const { task } = req.body;
      if (!task) {
        return res.status(400).json({ error: "Task is required" });
      }

      const getFallbackResult = () => {
        const score = task.priority === "High" ? 90 : task.priority === "Medium" ? 55 : 25;
        const emoji = task.category === "Work" ? "💼" : task.category === "Study" ? "✏️" : task.category === "Finance" ? "🪙" : "❤️";
        return {
          urgencyScore: score,
          nudge: "You can do this! Let's take it one small scribble at a time. ✨",
          emoji: emoji
        };
      };

      if (!ai) {
        return res.json(getFallbackResult());
      }

      const prompt = `Analyze this task and output a structured JSON response.
Task Title: "${task.title}"
Deadline: "${task.deadline}"
Priority: "${task.priority}"
Notes: "${task.notes || ""}"

We need:
1. "urgencyScore": a number from 1 to 100 representing how urgent it is based on priority and due time. High priority or close deadline should result in a score > 75.
2. "nudge": a short (one-sentence), warm, supportive, customized motivation nudge.
3. "emoji": a single, cute, relevant emoji.

Respond ONLY with a JSON object with keys: "urgencyScore" (number), "nudge" (string), and "emoji" (string).`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                urgencyScore: { type: Type.NUMBER },
                nudge: { type: Type.STRING },
                emoji: { type: Type.STRING },
              },
              required: ["urgencyScore", "nudge", "emoji"],
            },
          },
        });

        const data = JSON.parse(response.text || "{}");
        res.json(data);
      } catch (geminiError: any) {
        console.warn("Gemini analyze-task failed, using fallback:", geminiError);
        res.json(getFallbackResult());
      }
    } catch (error: any) {
      console.error("Task analysis error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // 3b. Brain Dump Zone conversion
  app.post("/api/brain-dump", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: "Messy thoughts text is required" });
      }

      const getFallbackResult = () => {
        const lines = text.split("\n").filter((l: string) => l.trim().length > 3);
        const fallbackTasks = lines.slice(0, 3).map((line: string, idx: number) => {
          const cleanLine = line.replace(/^[-*•\d.\s]+/, "").trim();
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(12, 0, 0, 0);

          return {
            title: cleanLine.substring(0, 50),
            category: "Personal",
            priority: "Medium",
            notes: cleanLine.length > 50 ? cleanLine : undefined,
            deadline: tomorrow.toISOString()
          };
        });
        return { tasks: fallbackTasks };
      };

      if (!ai) {
        return res.json(getFallbackResult());
      }

      const prompt = `You are "Nudge AI", a warm, supportive digital planner coach.
The user has poured out some messy, unstructured brain dump of thoughts:
"${text}"

Please parse this text and extract up to 4 clean, distinct, actionable tasks/quests.
For each extracted task, determine:
1. "title": a concise, active task name (under 50 characters, e.g. "Draft biology presentation" or "Buy grocery items")
2. "category": must be one of: "Personal", "Work", "Study", "Finance"
3. "priority": must be one of: "High", "Medium", "Low"
4. "notes": any additional detail or description, or leave empty/undefined
5. "deadline": a suggested deadline date-time as an ISO string. Suggest realistic deadlines relative to current time context.

Respond strictly in JSON with this format:
{
  "tasks": [
    {
      "title": "...",
      "category": "Study",
      "priority": "High",
      "notes": "...",
      "deadline": "2026-06-29T18:00:00.000Z"
    }
  ]
}`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                tasks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      category: { type: Type.STRING },
                      priority: { type: Type.STRING },
                      notes: { type: Type.STRING },
                      deadline: { type: Type.STRING }
                    },
                    required: ["title", "category", "priority", "deadline"]
                  }
                }
              },
              required: ["tasks"]
            }
          }
        });

        const data = JSON.parse(response.text || "{}");
        res.json(data);
      } catch (geminiError: any) {
        console.warn("Gemini brain-dump failed, using fallback:", geminiError);
        res.json(getFallbackResult());
      }
    } catch (error: any) {
      console.error("Brain dump conversion error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // 4. AI Deadline Predictor
  app.post("/api/predict-deadline", async (req, res) => {
    try {
      const { taskDescription, tasks, profileName, userType } = req.body;
      if (!taskDescription) {
        return res.status(400).json({ error: "Task description is required" });
      }

      const name = profileName || "friend";

      const getFallbackResult = () => {
        const isInterview = taskDescription.toLowerCase().includes("interview") || taskDescription.toLowerCase().includes("coding") || taskDescription.toLowerCase().includes("prep");
        const isReport = taskDescription.toLowerCase().includes("report") || taskDescription.toLowerCase().includes("page") || taskDescription.toLowerCase().includes("write");
        return {
          timeEstimate: isInterview ? "12-15 hours of study time" : isReport ? "5-7 hours of writing" : "2-4 hours of focused work",
          startRecommendation: `Hey ${name}! Start tonight in a cozy nook with warm tea! ✦`,
          urgencyRating: isInterview ? "High" : "Medium",
          tip: `Write down the absolute smallest micro-step and doodle it. You've got this, ${name}! 💡🌸`
        };
      };

      if (!ai) {
        return res.json(getFallbackResult());
      }

      const tasksSummary = (tasks || [])
        .map((t: any, i: number) => `- [${t.completed ? "Completed" : "Pending"}] ${t.title} | Priority: ${t.priority} | Due: ${t.deadline}`)
        .join("\n");

      const isStudent = userType === "Student";
      const toneInstruction = isStudent
        ? "Tone: Cozy, warm, encouraging student vibe. Mention studies, exams, course modules, or cozy study desks."
        : "Tone: Supportive, professional yet cozy work vibe. Mention deliverables, sprint priorities, team syncs, or career balance.";

      const prompt = `You are "Nudge AI", a friendly, empathetic productivity advisor.
The user's name is "${name}". You MUST address them personally as "${name}".
Analyze ${name}'s new task description: "${taskDescription}"
Consider their current planner tasks for workload context:
${tasksSummary || "None - clean slate!"}

${toneInstruction}

Evaluate:
1. "timeEstimate": A realistic time estimate to complete the task (e.g., "8-10 hours over 2 days").
2. "startRecommendation": The ideal start time based on current workloads and deadlines (e.g., "Start tomorrow morning to beat the rush").
3. "urgencyRating": An urgency rating which MUST be exactly one of: "Low", "Medium", "High".
4. "tip": A warm, cozy digital-planner-style tip addressing ${name} personally to keep them stress-free (e.g., "Start tonight to avoid last-minute stress, ${name}! 💡").

Respond ONLY with a JSON object containing the exact fields: "timeEstimate", "startRecommendation", "urgencyRating", and "tip".`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                timeEstimate: { type: Type.STRING },
                startRecommendation: { type: Type.STRING },
                urgencyRating: { type: Type.STRING },
                tip: { type: Type.STRING },
              },
              required: ["timeEstimate", "startRecommendation", "urgencyRating", "tip"],
            },
          },
        });

        const result = JSON.parse(response.text || "{}");
        res.json(result);
      } catch (geminiError: any) {
        console.warn("Gemini predict-deadline failed, using fallback:", geminiError);
        res.json(getFallbackResult());
      }
    } catch (error: any) {
      console.error("Predict deadline error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // 5. Habit Motivation Line
  app.post("/api/habit-motivation", async (req, res) => {
    try {
      const { streak } = req.body;
      const streakNum = Number(streak) || 0;

      const getFallbackResult = () => {
        return {
          motivation: streakNum > 0 
            ? `You're on an amazing ${streakNum} day streak — keep scribbling those daily quests! ☕🔥`
            : "No active streak yet, but today is a perfect day to fill your canvas with stars! ✦🌸"
        };
      };

      if (!ai) {
        return res.json(getFallbackResult());
      }

      const prompt = `You are "Nudge AI", a digital-planner buddy. Generate a single, short, cute, motivational sentence for a habit tracker based on the user's current streak of ${streakNum} days of task completion.
Keep it extremely encouraging, warm, cozy, and under 15 words. Include exactly 1 or 2 cute emojis (e.g. 🔥, ✦, 🌸, ☕, ✨). Do not output any notes, quotes, or JSON, just a plain string.`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
        });
        res.json({ motivation: response.text?.trim() });
      } catch (geminiError: any) {
        console.warn("Gemini habit-motivation failed, using fallback:", geminiError);
        res.json(getFallbackResult());
      }
    } catch (error: any) {
      console.error("Habit motivation error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // 5b. Weekly Report Card Comment
  app.post("/api/weekly-report", async (req, res) => {
    try {
      const { completedCount, totalCount, profileName } = req.body;
      const userName = profileName || "friend";
      const comp = Number(completedCount) || 0;
      const tot = Number(totalCount) || 0;

      const getFallbackResult = () => {
        if (tot === 0) {
          return { comment: `Hey ${userName}! 🌸 Ready to embark on some cozy quests this week? Add a task to start!` };
        }
        const ratio = comp / tot;
        if (ratio >= 0.8) {
          return { comment: `Sensational work, ${userName}! 🏆 You crushed ${comp} of your ${tot} quests. Your focus is truly inspiring! ⚡🌸` };
        } else if (ratio >= 0.5) {
          return { comment: `Great job, ${userName}! 🌟 You completed ${comp} of your ${tot} quests. Let's keep this lovely momentum going! ☕` };
        } else {
          return { comment: `A cozy step forward, ${userName}! 🧸 You tackled ${comp} of your ${tot} quests. Every small effort counts, so keep blooming at your own pace! ✦` };
        }
      };

      if (!ai) {
        return res.json(getFallbackResult());
      }

      const prompt = `You are "Nudge AI", a supportive digital planner buddy.
We are generating a Weekly Report Card comment for our user named "${userName}".
This week, they created ${tot} tasks/quests in total, and successfully completed ${comp} of them.
Generate a heartwarming, friendly, supportive, and motivating comment (under 30 words) praising their effort and encouraging them for the upcoming week.
Always mention the exact counts: they completed "${comp} out of ${tot}" or similar in a cozy style. Include 1 or 2 lovely emojis (e.g., 🌟, 🌸, 🏆, ☕, ✦).`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
        });
        res.json({ comment: response.text?.trim() });
      } catch (geminiError: any) {
        console.warn("Gemini weekly-report failed, using fallback:", geminiError);
        res.json(getFallbackResult());
      }
    } catch (error: any) {
      console.error("Weekly report error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // 6. Focus Suggestion Endpoint
  app.post("/api/focus-suggest", async (req, res) => {
    try {
      const { tasks, userType } = req.body;
      if (!tasks || !Array.isArray(tasks)) {
        return res.status(400).json({ error: "Tasks must be an array" });
      }

      const pendingTasks = tasks.filter(t => !t.completed);

      if (pendingTasks.length === 0) {
        return res.json({
          suggestion: "You crushed everything today! 🌟 Use this session to rest, read a cozy book, or plan tomorrow.",
          taskId: null
        });
      }

      const getFallbackResult = () => {
        const urgentTask = pendingTasks.find(t => t.priority === "High") || pendingTasks[0];
        return {
          suggestion: `Let's focus on "${urgentTask.title}" during this session! You've got this! 📚✨`,
          taskId: urgentTask.id,
          taskName: urgentTask.title
        };
      };

      if (!ai) {
        return res.json(getFallbackResult());
      }

      const tasksSummary = pendingTasks
        .map(
          (t, i) =>
            `- [ID: ${t.id}] "${t.title}" | Category: ${t.category} | Priority: ${t.priority} | Due: ${t.deadline}`
        )
        .join("\n");

      const isStudent = userType === "Student";
      const toneInstruction = isStudent
        ? "Tone: Cozy, warm, encouraging student vibe. Suggest keeping study guides close and focus clean."
        : "Tone: Confident, calm, efficient professional vibe. Suggest crossing off deliverables and focusing deeply.";

      const prompt = `You are "Nudge AI", a supportive digital planner buddy.
We are starting a 25-minute Pomodoro focus session.
Analyze the user's pending task list and suggest the single most important or urgent task to focus on during this session:
${tasksSummary}

${toneInstruction}

Please respond strictly in JSON with this format:
{
  "suggestion": "Hey! Use this session to work on <Task Name> <relevant emoji> You've got this! 📚",
  "taskId": "<the exact ID of the recommended task>",
  "taskName": "<the exact title of the recommended task>"
}`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                suggestion: { type: Type.STRING },
                taskId: { type: Type.STRING },
                taskName: { type: Type.STRING }
              },
              required: ["suggestion", "taskId", "taskName"]
            }
          }
        });

        const data = JSON.parse(response.text || "{}");
        res.json(data);
      } catch (geminiError: any) {
        console.warn("Gemini focus-suggest failed, using fallback:", geminiError);
        res.json(getFallbackResult());
      }
    } catch (error: any) {
      console.error("Focus suggest error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // 7. Focus Break Tip Endpoint
  app.post("/api/focus-break-tip", async (req, res) => {
    try {
      const { userType } = req.body;
      const getFallbackResult = () => {
        const fallbacks = [
          "Stretch your arms, look away from the screen, drink some water 💧",
          "Stand up and do a quick 1-minute stretch! Your muscles will thank you. 🌿",
          "Take three deep diaphragmatic breaths and look out the window. 🌸",
          "Make yourself a warm cup of herbal tea or rest your eyes. ☕"
        ];
        return { tip: fallbacks[Math.floor(Math.random() * fallbacks.length)] };
      };

      if (!ai) {
        return res.json(getFallbackResult());
      }

      const isStudent = userType === "Student";
      const toneInstruction = isStudent
        ? "Tone: Cozy, warm encouraging student study break coach."
        : "Tone: Confident, calm professional work wellness and productivity coach.";

      const prompt = `You are "Nudge AI", a warm, cozy digital planner buddy.
The user is taking a break from their study/work session.

${toneInstruction}

Suggest a short, lovely, mindful break tip (under 15 words) that encourages them to stretch, rest their eyes, drink water, or take deep breaths.
Include 1 or 2 cozy emojis. Output only the tip string, no JSON, quotes, or introduction.`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
        });

        res.json({ tip: response.text?.trim() });
      } catch (geminiError: any) {
        console.warn("Gemini focus-break-tip failed, using fallback:", geminiError);
        res.json(getFallbackResult());
      }
    } catch (error: any) {
      console.error("Focus break tip error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // --- Exclusive Student Endpoint: Assignment Breakdown ---
  app.post("/api/breakdown", async (req, res) => {
    try {
      const assignmentTitle = req.body.assignmentTitle || req.body.assignment;
      const assignmentNotes = req.body.assignmentNotes || "";
      if (!assignmentTitle) {
        return res.status(400).json({ error: "Assignment title is required" });
      }

      const getFallbackResult = () => {
        const titleLower = assignmentTitle.toLowerCase();
        const notesLower = assignmentNotes.toLowerCase();
        const combined = `${titleLower} ${notesLower}`;

        let steps: { title: string; notes: string }[] = [];

        if (combined.match(/\b(code|programming|python|javascript|java|c\+\+|react|html|css|bug|git|database|app|website|build|develop|coder|backend|frontend|node|api|sql|typescript)\b/)) {
          steps = [
            { title: "Define scope & draft architecture", notes: "Sketch out the component structure or flow diagrams before writing any lines of code." },
            { title: "Set up repository & environment", notes: "Initialize your repository, install dependencies, and run a basic 'hello world' test." },
            { title: "Implement core functional logic", notes: "Build the primary functions or features first, checking your code iteratively. 💻" },
            { title: "Debug, test & refine code", notes: "Run edge cases, verify code format, and write comments for any complex sections." }
          ];
        } else if (combined.match(/\b(math|calculus|algebra|physics|equation|formula|problem|solve|maths|geometry|statistics|stats|proof|theorem|fraction|arithmetic)\b/)) {
          steps = [
            { title: "Review formulas & key concepts", notes: "Briefly look over textbook chapters, relevant formulas, and standard sample problems." },
            { title: "Deconstruct the problem statements", notes: "Write down what variables are given and what you are trying to solve for." },
            { title: "Work through calculations step-by-step", notes: "Show your complete working clearly. Focus on accuracy over speed. ✏️" },
            { title: "Double-check answers & units", notes: "Plug your answers back into equations, check unit consistency, and verify logic." }
          ];
        } else if (combined.match(/\b(read|article|paper|book|chapter|novel|literature|review|textbook|reading|poetry|poem|anthology)\b/) && !combined.match(/\b(write|essay)\b/)) {
          steps = [
            { title: "Skim headers & set learning goals", notes: "Look at the introduction, main headings, and summaries to understand the structure." },
            { title: "Active reading with annotations", notes: "Highlight key definitions, main thesis arguments, and write down questions in margins. 📖" },
            { title: "Summarize major takeaways", notes: "Write a short 3-sentence summary of the reading to solidify your understanding." },
            { title: "Review notes & clarify confusion", notes: "Look up any unfamiliar terminology or complex arguments that you highlighted." }
          ];
        } else if (combined.match(/\b(presentation|slides|powerpoint|ppt|pitch|speech|talk|slideshow|keynote)\b/)) {
          steps = [
            { title: "Outline main narrative & takeaways", notes: "Determine your core message and structure it into a compelling hook, body, and conclusion." },
            { title: "Design clean visual slides", notes: "Use high contrast, minimal text, and simple visual layouts to support your talk. 🎨" },
            { title: "Practice delivering the talk", notes: "Time yourself speaking out loud to get comfortable with the pacing and transitions." },
            { title: "Final check & equipment prep", notes: "Ensure your files open correctly, and double-check slide text for typos." }
          ];
        } else if (combined.match(/\b(study|exam|quiz|test|midterm|final|prep|review for|revision|test prep|examinations)\b/)) {
          steps = [
            { title: "Create a topic checklist", notes: "Review the syllabus to list all key concepts that will be covered on the exam." },
            { title: "Review past notes & slides", notes: "Spend dedicated blocks reviewing lectures, reading notes, and star key concepts." },
            { title: "Take mock quizzes & practice tests", notes: "Test yourself under real exam conditions to find gaps in your knowledge. 🧠" },
            { title: "Focus on weak spots & rest", notes: "Review mistakes, do a gentle review, and sleep well before the big day." }
          ];
        } else if (combined.match(/\b(lab|experiment|chemistry|biology|science|report|scientific|microscope|cell|genetics|ecological|chemical|substance)\b/)) {
          steps = [
            { title: "Review experimental hypothesis", notes: "Clearly define the independent/dependent variables and the core scientific question." },
            { title: "Analyze collected data", notes: "Organize your raw measurements into clean tables or plots to identify trends." },
            { title: "Draft introduction & methodology", notes: "Explain the background science, lab apparatus used, and step-by-step procedure." },
            { title: "Write discussion & conclusion", notes: "Interpret results, address potential sources of experimental error, and summarize findings. 🔬" }
          ];
        } else if (combined.match(/\b(design|draw|paint|art|creative|sketch|portfolio|framer|figma|sculpture|music|compose|video|edit|illustration|ui|ux)\b/)) {
          steps = [
            { title: "Gather inspiration & mood board", notes: "Collect references, color palettes, and structural layouts that match your vision." },
            { title: "Draft rough sketches or wireframes", notes: "Create multiple quick, low-fidelity concepts to explore different directions. 🎨" },
            { title: "Build the high-fidelity version", notes: "Flesh out details, alignment, typography, and clean up layers/assets." },
            { title: "Request feedback & polish", notes: "Take a break, review with fresh eyes, and fine-tune details for a stunning presentation." }
          ];
        } else if (combined.match(/\b(write|essay|thesis|composition|draft|paper|report|paragraph|proposal|article|blog)\b/)) {
          steps = [
            { title: "Gather sources & outline thesis", notes: "Research references, formulate a strong thesis statement, and map out body paragraphs." },
            { title: "Draft a solid structural outline", notes: "Briefly list the topic sentences and supporting evidence for each paragraph. ✍️" },
            { title: "Write the complete first draft", notes: "Focus on writing flow and getting ideas down; you can edit style and grammar later." },
            { title: "Edit for clarity & formatting", notes: "Polish your transitions, double-check citations, and read aloud to ensure lovely flow." }
          ];
        } else {
          steps = [
            { title: "Deconstruct core requirements", notes: `Identify specific guidelines, resources, and deadlines for "${assignmentTitle}".` },
            { title: "Outline structure & key sections", notes: "Break the task into manageable chunks to eliminate stress and organize your approach." },
            { title: "Draft or construct the solution", notes: "Focus on building out the substance first, maintaining high productivity. 🚀" },
            { title: "Review, refine & polish", notes: "Do a final check against criteria, fix minor details, and perfect the deliverable." }
          ];
        }

        const breakdown = steps.map(s => ({
          step: s.title,
          detail: s.notes
        }));
        return { steps, breakdown };
      };

      if (!ai) {
        return res.json(getFallbackResult());
      }

      const prompt = `You are "Nudge AI", an exceptionally smart, warm, and encouraging academic coach.
Analyze this student assignment or study task:
Title: "${assignmentTitle}"
Notes/Context: "${assignmentNotes}"

Create a highly realistic, accurate, and practical step-by-step breakdown tailored specifically to the nature of this subject. For example:
- If it is programming, focus on logic design, environment setup, modular implementation, testing, and debugging.
- If it is math or physics, focus on concepts/formulas, structuring the known variables, step-by-step calculations, and double-checking work.
- If it is writing or essays, focus on thesis formulation, research, structured drafting, and peer/self-editing.
- If it is exams or tests, focus on high-yield topic listing, review methods, active recall, and mock practice.

Generate 3 to 4 logical, highly actionable step-by-step sequential subtasks.
Keep each step title concise (under 8 words) and provide a supportive, helpful 1-sentence tip/notes detailing exactly how to approach it.

Please respond strictly in JSON with this format:
{
  "steps": [
    {
      "title": "...",
      "notes": "..."
    }
  ]
}`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                steps: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      notes: { type: Type.STRING }
                    },
                    required: ["title", "notes"]
                  }
                }
              },
              required: ["steps"]
            }
          }
        });

        const data = JSON.parse(response.text || "{}");
        const rawSteps = data.steps || [];
        const formattedBreakdown = rawSteps.map((s: any) => ({
          step: s.title || s.step || "",
          detail: s.notes || s.detail || ""
        }));
        res.json({
          steps: rawSteps,
          breakdown: formattedBreakdown
        });
      } catch (geminiError) {
        console.warn("Gemini breakdown failed, using fallback:", geminiError);
        res.json(getFallbackResult());
      }
    } catch (error: any) {
      console.error("Assignment breakdown error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // --- Exclusive Working Professional Endpoint: Meeting Prep ---
  app.post("/api/meeting-prep", async (req, res) => {
    try {
      const agenda = req.body.agenda || req.body.topic;
      if (!agenda) {
        return res.status(400).json({ error: "Agenda is required" });
      }

      const getFallbackResult = () => {
        return {
          prep: {
            talkingPoints: [
              "Present status of current deliverables & milestones achieved",
              "Highlight any blockers, risks or external resource dependencies",
              "Propose concrete next steps and confirm ownership of tasks"
            ],
            questions: [
              "What is our top priority for this cycle?",
              "Are there any resource constraints or blockers we should flag?",
              "Who is the main owner for the next milestone?"
            ],
            checklist: [
              "Review slide deck, shared documents, or agenda notes beforehand",
              "Prepare status updates on active work and next milestones",
              "Take a deep breath and have a cup of water/coffee ready ☕"
            ]
          }
        };
      };

      if (!ai) {
        return res.json(getFallbackResult());
      }

      const prompt = `You are "Nudge AI", an encouraging professional coach and chief assistant.
The user is preparing for an upcoming meeting.
Meeting Agenda/Topic: "${agenda}"
Generate a comprehensive meeting preparation guide in JSON with:
1. "talkingPoints": 3 main bullet points they should bring up during the meeting, tailored to the meeting topic.
2. "questions": 3 valuable, professional questions they can raise during discussion.
3. "checklist": 3 actionable check-list items they should complete to prepare before the meeting starts.

Please respond strictly in JSON with this format:
{
  "talkingPoints": ["...", "...", "..."],
  "questions": ["...", "...", "..."],
  "checklist": ["...", "...", "..."]
}`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                talkingPoints: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                questions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                checklist: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["talkingPoints", "questions", "checklist"]
            }
          }
        });

        const data = JSON.parse(response.text || "{}");
        res.json({
          prep: {
            talkingPoints: data.talkingPoints || [],
            questions: data.questions || [],
            checklist: data.checklist || []
          }
        });
      } catch (geminiError) {
        console.warn("Gemini meeting-prep failed, using fallback:", geminiError);
        res.json(getFallbackResult());
      }
    } catch (error: any) {
      console.error("Meeting prep error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // --- Exclusive Working Professional Endpoint: Work-Life Balance Tip ---
  app.all("/api/work-life-tip", async (req, res) => {
    try {
      const { workHours, meTimeMinutes } = req.body || {};
      const hours = Number(workHours) || 8;
      const meTime = Number(meTimeMinutes) || 30;

      const getFallbackResult = () => {
        if (hours > 9) {
          return { tip: "You've worked a long day today! Please step away, mute work notifications, and spend 15 minutes listening to relaxing music. ☕🌿" };
        } else if (meTime < 30) {
          return { tip: "Your 'Me-Time' is looking a bit low. Treat yourself to a 10-minute cozy stretch or a warm cup of tea right now! 🌸" };
        } else {
          return { tip: "Your day looks beautifully balanced! Carry this steady momentum into your evening and enjoy your rest. ✦🍀" };
        }
      };

      if (!ai) {
        return res.json(getFallbackResult());
      }

      const prompt = `You are "Nudge AI", a supportive coach and advocate for healthy work-life balance.
The user logged ${hours} work hours and ${meTime} minutes of personal "me-time" today.
Provide a short, comforting, customized tip (under 25 words) that gently advises them on maintaining balance, avoiding burnout, or celebrating their peaceful alignment.
Use 1 or 2 warm, cozy emojis. Output only the tip string, no JSON, quotes, or introduction.`;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
        });

        res.json({ tip: response.text?.trim() });
      } catch (geminiError) {
        console.warn("Gemini work-life-tip failed, using fallback:", geminiError);
        res.json(getFallbackResult());
      }
    } catch (error: any) {
      console.error("Work-life tip error:", error);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });

  // Serve static assets
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
