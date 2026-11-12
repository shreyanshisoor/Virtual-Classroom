// Load dotenv only in non-production environments
// This prevents the local .env file from overriding Render's DATABASE_URL
if (process.env.NODE_ENV !== 'production') {
  require("dotenv").config();
}
const bcrypt = require("bcrypt");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const http = require("http");
const { PrismaClient } = require("@prisma/client");
const adminRoutes = require("./routes/admin");
const attendanceRoutes = require("./routes/attendance");
const { createWebSocketServer } = require("./websocket");
const { validatePassword } = require("./middleware/validatePassword");

const app = express();
const prisma = new PrismaClient();

// FILE UPLOAD CONFIG - Use /tmp for uploads on Render (read-only filesystem)
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");

// Ensure uploads directory exists
const fs = require('fs');
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch (e) {
  console.error("Failed to create uploads directory:", e);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

app.use(cors());
app.use(express.json());

app.use("/uploads", express.static(uploadsDir));

// Serve frontend static files
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Mount admin routes
app.use("/admin", adminRoutes);

// Mount attendance routes
app.use("/faculty/attendance", attendanceRoutes);

// Admin login alias (so /login/admin works like /login/student)
app.post("/login/admin", async (req, res) => {
  try {
    const { uid, password } = req.body;

    const admin = await prisma.admin.findUnique({ where: { uid } });

    if (!admin) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, admin.password);

    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({
      message: "Admin login successful",
      uid: admin.uid,
      name: admin.name
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Test route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "idx1.html"));
});

/* =========================
   STUDENT AUTH
========================= */

// Register Student
app.post("/register/student", async (req, res) => {
  try {
    const { uid, name, password } = req.body;

    if (!uid || !password) {
      return res.status(400).json({ error: "UID and password required" });
    }

    // Password strength validation (before hashing)
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.error });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const student = await prisma.student.create({
      data: { uid, name: name || uid, password: hashedPassword }
    });

    res.json({ message: "Student registered successfully", uid: student.uid, name: student.name });

  } catch (error) {
    console.error(error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: "UID already exists" });
    }
    res.status(500).json({ error: error.message });
  }
});

// Login Student
app.post("/login/student", async (req, res) => {
  try {
    const { uid, password } = req.body;

    const student = await prisma.student.findUnique({
      where: { uid }
    });

    if (!student) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, student.password);

    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({ message: "Login successful", uid: student.uid, name: student.name });

  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
});

/* =========================
   FACULTY AUTH
========================= */

// Register Faculty
app.post("/register/faculty", async (req, res) => {
  try {
    const { uid, name, password } = req.body;

    if (!uid || !password) {
      return res.status(400).json({ error: "UID and password required" });
    }

    // Password strength validation (before hashing)
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.error });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const faculty = await prisma.faculty.create({
      data: { uid, name: name || uid, password: hashedPassword }
    });

    res.json({ message: "Faculty registered successfully", uid: faculty.uid, name: faculty.name });

  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: "UID already exists" });
    }
    res.status(500).json({ error: error.message });
  }
});

// Login Faculty
app.post("/login/faculty", async (req, res) => {
  try {
    const { uid, password } = req.body;

    const faculty = await prisma.faculty.findUnique({
      where: { uid }
    });

    if (!faculty) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, faculty.password);

    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({ message: "Faculty login successful", uid: faculty.uid, name: faculty.name });

  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/faculty/material", upload.single("file"), async (req, res) => {
  try {
    const { chapterId, title } = req.body;

    if (!req.file || !chapterId || !title) {
      return res.status(400).json({ error: "All fields required" });
    }

    const fileUrl = `/uploads/${req.file.filename}`;

    await prisma.studyMaterial.create({
      data: {
        title,
        link: fileUrl,
        chapterId: parseInt(chapterId)
      }
    });

    res.json({ message: "Material uploaded successfully" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Upload failed" });
  }
});
/* =========================
   DASHBOARDS
========================= */

// Faculty Dashboard
app.get("/faculty/dashboard/:uid", async (req, res) => {
  try {
    const { uid } = req.params;

    const faculty = await prisma.faculty.findUnique({
      where: { uid },
      include: {
        subjects: {
          include: {
            timetables: true,
            liveClasses: true,
            section: true,
            units: {
              orderBy: { order: "asc" },
              include: {
                chapters: {
                  orderBy: { order: "asc" }
                }
              }
            }
          }
        }
      }
    });

    if (!faculty) {
      return res.status(404).json({ error: "Faculty not found" });
    }

    res.json({
      uid: faculty.uid,
      name: faculty.name,
      subjects: faculty.subjects
    });

  } catch (error) {
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});
// Student Dashboard
app.get("/student/dashboard/:uid", async (req, res) => {
  try {
    const { uid } = req.params;

    const student = await prisma.student.findUnique({
      where: { uid },
      include: {
        section: {
          include: {
            subjects: {
              include: {
                timetables: true,
                liveClasses: true,
                faculty: {
                  select: {
                    uid: true,
                    name: true
                  }
                },
                units: {
                  orderBy: { order: "asc" },
                  include: {
                    chapters: {
                      orderBy: { order: "asc" },
                      include: {
                        materials: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    res.json({
      uid: student.uid,
      name: student.name,
      section: student.section
    });

  } catch (error) {
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});



/* =========================
   LIVE CLASS
========================= */

app.post("/faculty/liveclass", async (req, res) => {
  try {
    const { subjectId, topic, link, date } = req.body;

    if (!subjectId || !topic || !link || !date) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const liveClass = await prisma.liveClass.create({
      data: {
        subjectId: parseInt(subjectId),
        topic,
        link,
        date: new Date(date)
      }
    });

    res.json({ message: "Live class created successfully", liveClass });

  } catch (error) {
    res.status(500).json({ error: "Failed to create live class" });
  }
});

app.get("/academic/setup", async (req, res) => {
  try {
    const subject = await prisma.subject.findFirst({
      where: { name: "DBMS" }
    });

    if (!subject) return res.json({ error: "Subject not found" });

    const unit1 = await prisma.unit.create({
      data: {
        title: "Unit 1 (Theory)",
        order: 1,
        subjectId: subject.id
      }
    });

    const unit2 = await prisma.unit.create({
      data: {
        title: "Unit 2 (Theory)",
        order: 2,
        subjectId: subject.id
      }
    });

    await prisma.chapter.createMany({
      data: [
        { title: "Chapter 1.1", order: 1, unitId: unit1.id },
        { title: "Chapter 1.2", order: 2, unitId: unit1.id },
        { title: "Chapter 2.1", order: 1, unitId: unit2.id }
      ]
    });

    res.json({ message: "Units & Chapters created successfully" });

  } catch (err) {
    res.json({ error: err.message });
  }
});

// Note: /faculty/material is already defined above with multer file upload support
//Create Quiz(Faculty)
app.post("/faculty/quiz", async (req, res) => {
  try {
    const { title, openDate, closeDate, timeLimit, attempts, unitId } = req.body;

    const quiz = await prisma.quiz.create({
      data: {
        title,
        openDate: new Date(openDate),
        closeDate: new Date(closeDate),
        timeLimit,
        attempts,
        unitId
      }
    });

    res.json({ message: "Quiz created", quiz });

  } catch (error) {
    res.status(500).json({ error: "Failed to create quiz" });
  }
});
//add question
app.post("/faculty/question", async (req, res) => {
  try {
    const { quizId, question, optionA, optionB, optionC, optionD, correct } = req.body;

    const q = await prisma.question.create({
      data: {
        quizId,
        question,
        optionA,
        optionB,
        optionC,
        optionD,
        correct
      }
    });

    res.json({ message: "Question added", q });

  } catch (error) {
    res.status(500).json({ error: "Failed to add question" });
  }
});

//Get quiz
app.get("/student/quiz/:quizId", async (req, res) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id: parseInt(req.params.quizId) },
    include: { questions: true }
  });

  res.json(quiz);
});

//Submit quiz
app.post("/student/quiz/submit", async (req, res) => {
  try {
    const { quizId, studentId, answers } = req.body;

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: { questions: true }
    });

    let score = 0;

    quiz.questions.forEach(q => {
      if (answers[q.id] === q.correct) {
        score++;
      }
    });

    const submission = await prisma.quizSubmission.create({
      data: {
        quizId,
        studentId,
        score,
        startedAt: new Date(),
        completedAt: new Date()
      }
    });

    res.json({ message: "Quiz submitted", score });

  } catch (error) {
    res.status(500).json({ error: "Submission failed" });
  }
});

/* =========================
   POLL MANAGEMENT API
========================= */

// Get all quizzes for poll selection (Faculty)
app.get("/faculty/polls", async (req, res) => {
  try {
    const quizzes = await prisma.quiz.findMany({
      include: {
        questions: true,
        unit: {
          select: {
            title: true,
            order: true,
            subject: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: { openDate: "desc" }
    });

    res.json({ quizzes });
  } catch (error) {
    console.error("Error fetching quizzes:", error);
    res.status(500).json({ error: "Failed to fetch quizzes" });
  }
});

// Get quiz for poll creation (student view - public access for preview)
app.get("/student/quizzes", async (req, res) => {
  try {
    const quizzes = await prisma.quiz.findMany({
      include: {
        questions: {
          select: {
            id: true,
            question: true,
            optionA: true,
            optionB: true,
            optionC: true,
            optionD: true
          }
        },
        unit: {
          select: {
            title: true,
            subject: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: { openDate: "desc" }
    });

    res.json({ quizzes });
  } catch (error) {
    console.error("Error fetching quizzes:", error);
    res.status(500).json({ error: "Failed to fetch quizzes" });
  }
});

// Start a live poll (broadcasts via WebSocket)
app.post("/faculty/poll/start", async (req, res) => {
  try {
    const { quizId, timeLimit, roomId } = req.body;

    if (!quizId || !roomId) {
      return res.status(400).json({ error: "quizId and roomId are required" });
    }

    // Fetch quiz with questions
    const quiz = await prisma.quiz.findUnique({
      where: { id: parseInt(quizId) },
      include: {
        questions: {
          select: {
            id: true,
            question: true,
            optionA: true,
            optionB: true,
            optionC: true,
            optionD: true,
            correct: true
          }
        }
      }
    });

    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    // Create Poll record
    const poll = await prisma.poll.create({
      data: {
        title: quiz.title,
        quizId: parseInt(quizId),
        timeLimit: timeLimit || 60 // default 60 seconds
      }
    });

    // Broadcast poll start via WebSocket
    if (wss && roomId) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'poll-start',
            pollId: poll.id,
            quizId: quiz.id,
            roomId: roomId,
            questions: quiz.questions,
            timeLimit: timeLimit || 60
          }));
        }
      });
    }

    res.json({
      message: "Poll started successfully",
      poll: {
        id: poll.id,
        title: poll.title,
        timeLimit: poll.timeLimit,
        questions: quiz.questions
      }
    });

  } catch (error) {
    console.error("Error starting poll:", error);
    res.status(500).json({ error: "Failed to start poll" });
  }
});

// Submit poll answers
app.post("/student/poll/answer", async (req, res) => {
  try {
    const { pollId, questionId, selectedOption, studentId, roomId } = req.body;

    if (!pollId || !questionId || !studentId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Check if poll exists and is active
    const poll = await prisma.poll.findUnique({
      where: { id: parseInt(pollId) }
    });

    if (!poll || !poll.isActive) {
      return res.status(400).json({ error: "Poll not active" });
    }

    // Store or update poll answer
    const existingAnswer = await prisma.pollAnswer.findUnique({
      where: {
        pollId_studentId_questionId: {
          pollId: parseInt(pollId),
          studentId: parseInt(studentId),
          questionId: parseInt(questionId)
        }
      }
    });

    if (existingAnswer) {
      await prisma.pollAnswer.update({
        where: {
          pollId_studentId_questionId: {
            pollId: parseInt(pollId),
            studentId: parseInt(studentId),
            questionId: parseInt(questionId)
          }
        },
        data: {
          selectedOption,
          answeredAt: new Date()
        }
      });
    } else {
      await prisma.pollAnswer.create({
        data: {
          pollId: parseInt(pollId),
          studentId: parseInt(studentId),
          questionId: parseInt(questionId),
          selectedOption
        }
      });
    }

    // Broadcast answer update via WebSocket
    if (wss && roomId) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'poll-answer',
            pollId: parseInt(pollId),
            questionId: parseInt(questionId),
            selectedOption
          }));
        }
      });
    }

    res.json({ message: "Answer submitted successfully" });

  } catch (error) {
    console.error("Error submitting poll answer:", error);
    res.status(500).json({ error: "Failed to submit answer" });
  }
});

// Submit all poll answers (finalize submission)
app.post("/student/poll/submit", async (req, res) => {
  try {
    const { pollId, studentId, answers } = req.body;

    if (!pollId || !studentId || !answers || Object.keys(answers).length === 0) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const poll = await prisma.poll.findUnique({
      where: { id: parseInt(pollId) }
    });

    if (!poll || !poll.isActive) {
      return res.status(400).json({ error: "Poll not active" });
    }

    const submittedAnswers = [];
    for (const [questionId, selectedOption] of Object.entries(answers)) {
      // Check for existing answer
      const existingAnswer = await prisma.pollAnswer.findUnique({
        where: {
          pollId_studentId_questionId: {
            pollId: parseInt(pollId),
            studentId: parseInt(studentId),
            questionId: parseInt(questionId)
          }
        }
      });

      if (!existingAnswer) {
        await prisma.pollAnswer.create({
          data: {
            pollId: parseInt(pollId),
            studentId: parseInt(studentId),
            questionId: parseInt(questionId),
            selectedOption
          }
        });
      }

      submittedAnswers.push({
        questionId: parseInt(questionId),
        selectedOption
      });
    }

    res.json({
      message: "Poll submitted successfully",
      answers: submittedAnswers.length
    });

  } catch (error) {
    console.error("Error submitting poll:", error);
    res.status(500).json({ error: "Failed to submit poll" });
  }
});

// Get poll results
app.get("/student/poll/results/:pollId", async (req, res) => {
  try {
    const { pollId } = req.params;
    const poll = await prisma.poll.findUnique({
      where: { id: parseInt(pollId) },
      include: {
        quiz: {
          include: {
            questions: true
          }
        }
      }
    });

    if (!poll) {
      return res.status(404).json({ error: "Poll not found" });
    }

    // Get all answers
    const answers = await prisma.pollAnswer.findMany({
      where: { pollId: parseInt(pollId) }
    });

    // Calculate results
    const results = {};
    const questions = poll.quiz.questions;

    questions.forEach(q => {
      results[q.id] = {
        question: q.question,
        options: {
          A: { count: 0, percentage: 0 },
          B: { count: 0, percentage: 0 },
          C: { count: 0, percentage: 0 },
          D: { count: 0, percentage: 0 }
        },
        totalResponses: answers.filter(a => a.questionId === q.id).length
      };
    });

    // Count answers
    answers.forEach(answer => {
      if (results[answer.questionId] && results[answer.questionId].options[answer.selectedOption]) {
        results[answer.questionId].options[answer.selectedOption].count++;
      }
    });

    // Calculate percentages
    Object.entries(results).forEach(([qid, result]) => {
      const total = result.totalResponses;
      if (total > 0) {
        Object.keys(result.options).forEach(opt => {
          result.options[opt].percentage = Math.round((result.options[opt].count / total) * 100);
        });
      }
    });

    // Get fastest correct respondents
    const fastestResponders = await prisma.pollAnswer.findMany({
      where: { pollId: parseInt(pollId) },
      orderBy: { answeredAt: 'asc' },
      take: 5,
      select: {
        studentId: true,
        questionId: true,
        selectedOption: true,
        answeredAt: true
      }
    });

    res.json({
      poll: {
        id: poll.id,
        title: poll.title,
        isActive: poll.isActive,
        timeLimit: poll.timeLimit,
        startedAt: poll.startedAt,
        endedAt: poll.endTime
      },
      results,
      fastestResponders
    });

  } catch (error) {
    console.error("Error fetching poll results:", error);
    res.status(500).json({ error: "Failed to fetch poll results" });
  }
});

// End a poll
app.post("/faculty/poll/end", async (req, res) => {
  try {
    const { pollId } = req.body;

    if (!pollId) {
      return res.status(400).json({ error: "pollId is required" });
    }

    const poll = await prisma.poll.findUnique({
      where: { id: parseInt(pollId) }
    });

    if (!poll) {
      return res.status(404).json({ error: "Poll not found" });
    }

    // Update poll status
    await prisma.poll.update({
      where: { id: parseInt(pollId) },
      data: {
        isActive: false,
        endTime: new Date()
      }
    });

    // Broadcast poll end via WebSocket
    if (wss) {
      const results = {};
      // Get all answers and calculate results
      const answers = await prisma.pollAnswer.findMany({
        where: { pollId: parseInt(pollId) }
      });

      const questions = poll.quiz.questions;
      questions.forEach(q => {
        results[q.id] = {
          question: q.question,
          options: {
            A: { count: 0, percentage: 0 },
            B: { count: 0, percentage: 0 },
            C: { count: 0, percentage: 0 },
            D: { count: 0, percentage: 0 }
          },
          totalResponses: answers.filter(a => a.questionId === q.id).length
        };
      });

      answers.forEach(answer => {
        if (results[answer.questionId] && results[answer.questionId].options[answer.selectedOption]) {
          results[answer.questionId].options[answer.selectedOption].count++;
        }
      });

      Object.entries(results).forEach(([qid, result]) => {
        const total = result.totalResponses;
        if (total > 0) {
          Object.keys(result.options).forEach(opt => {
            result.options[opt].percentage = Math.round((result.options[opt].count / total) * 100);
          });
        }
      });

      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'poll-ended',
            pollId: parseInt(pollId),
            results
          }));
        }
      });
    }

    res.json({ message: "Poll ended successfully" });

  } catch (error) {
    console.error("Error ending poll:", error);
    res.status(500).json({ error: "Failed to end poll" });
  }
});

/* =========================
   AI TUTOR API
========================= */

// Helper function to get AI response from Gemini or OpenAI
async function getAIResponse(messages, currentContext = {}) {
  const geminiKey = process.env.GOOGLE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // Build the system prompt with context
  const systemPrompt = `You are an AI Study Buddy, a helpful academic assistant for students in the Virtual Classroom.

Current Context:
- Current Subject: ${currentContext.subjectName || 'General'}
- Current Unit: ${currentContext.unitTitle || 'N/A'}
- Current Chapter: ${currentContext.chapterTitle || 'N/A'}

Guidelines:
- Be friendly, concise, and encouraging
- Provide explanations, not just answers
- If possible, relate concepts to real-world examples
- Keep responses academic but approachable
- If a question is unclear, ask for clarification
- Never reveal that you're an AI, just be a helpful study buddy

Format: Respond in plain text, ready to display in a chat bubble.`;

  const formattedMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  // Try Gemini first if API key is available
  if (geminiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: formattedMessages.map((m, i) => ({
            role: i === 0 ? 'model' : m.role,
            parts: [{ text: m.content }]
          })),
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm not sure about that. Could you rephrase your question?";
      }
    } catch (error) {
      console.error('Gemini API error:', error.message);
    }
  }

  // Fallback to OpenAI if API key is available
  if (openaiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: formattedMessages,
          temperature: 0.7,
          max_tokens: 1000
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "I'm not sure about that. Could you rephrase your question?";
      }
    } catch (error) {
      console.error('OpenAI API error:', error.message);
    }
  }

  // Return default response if no API keys are configured
  return "I'm here to help with your studies! Please set up an AI provider (GOOGLE_API_KEY or OPENAI_API_KEY) to enable full functionality. For now, I can answer general questions or you can ask me to help with summarizing topics, explaining formulas, or creating quizzes.";
}

// AI Tutor endpoint
app.post("/api/ai-tutor", async (req, res) => {
  try {
    const { messages, currentContext } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages array is required" });
    }

    // Get AI response
    const aiResponse = await getAIResponse(messages, currentContext || {});

    res.json({
      success: true,
      response: aiResponse,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('AI Tutor error:', error);
    res.status(500).json({ error: "Failed to get AI response" });
  }
});

// Get quick action suggestions based on current context
app.get("/api/ai-tutor/quick-actions", async (req, res) => {
  try {
    const { subjectId, unitId, chapterId } = req.query;

    let actions = [
      { id: 'summarize', label: 'Summarize current topic', icon: '📝' },
      { id: 'explain', label: 'Explain formula', icon: '🔢' },
      { id: 'quiz', label: 'Quiz me on this', icon: '❓' }
    ];

    // If we have context, provide more specific actions
    if (subjectId) {
      const subject = await prisma.subject.findUnique({
        where: { id: parseInt(subjectId) },
        select: { name: true }
      });

      if (subject) {
        actions = [
          { id: 'summarize', label: `Summarize ${subject.name} concepts`, icon: '📝' },
          { id: 'explain', label: 'Explain a formula', icon: '🔢' },
          { id: 'quiz', label: 'Create quiz on related topics', icon: '❓' }
        ];
      }
    }

    res.json({ success: true, actions });

  } catch (error) {
    console.error('Quick actions error:', error);
    res.status(500).json({ error: "Failed to get quick actions" });
  }
});

/* =========================
   STUDENT ATTENDANCE VIEW
========================= */
app.get("/student/attendance/:uid", async (req, res) => {
  try {
    const { uid } = req.params;

    const student = await prisma.student.findUnique({
      where: { uid },
      include: { section: true }
    });

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    if (!student.sectionId) {
      return res.json({ courses: [] });
    }

    // Get all courses in student's section
    const courses = await prisma.subject.findMany({
      where: { sectionId: student.sectionId },
      include: {
        faculty: { select: { name: true } },
        attendanceSessions: {
          where: { sectionId: student.sectionId },
          include: {
            records: {
              where: { studentId: student.id }
            }
          },
          orderBy: { lectureDate: "asc" }
        }
      }
    });

    // Compute attendance dynamically
    const result = courses.map(course => {
      const totalSessions = course.attendanceSessions.length;
      let presentCount = 0;

      course.attendanceSessions.forEach(session => {
        const record = session.records[0]; // only this student's record
        if (record && record.status === "present") {
          presentCount++;
        }
      });

      const percentage = totalSessions > 0
        ? Math.round((presentCount / totalSessions) * 100)
        : 0;

      return {
        courseId: course.id,
        courseName: course.name,
        faculty: course.faculty?.name || "N/A",
        totalLectures: totalSessions,
        present: presentCount,
        absent: totalSessions - presentCount,
        percentage
      };
    });

    res.json({ courses: result });
  } catch (error) {
    console.error("Student attendance error:", error);
    res.status(500).json({ error: "Failed to fetch attendance" });
  }
});

/* =========================
   HTTP & WEBSOCKET SERVER
========================= */

// Health check for WebSocket
app.get('/ws-health', (req, res) => {
  res.json({ status: 'ok', websocket: 'running' });
});

const server = http.createServer(app);
const wss = createWebSocketServer(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
