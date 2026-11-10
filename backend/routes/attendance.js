/**
 * Attendance Routes — Virtual Classroom
 * Faculty-protected routes for section-based attendance.
 */
const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

/* ----------------------------------------------------------
   MIDDLEWARE — Validate faculty UID from header
---------------------------------------------------------- */
async function facultyAuth(req, res, next) {
    const uid = req.headers["x-faculty-uid"];
    if (!uid) {
        return res.status(401).json({ error: "Faculty UID required" });
    }
    const faculty = await prisma.faculty.findUnique({ where: { uid } });
    if (!faculty) {
        return res.status(401).json({ error: "Invalid faculty" });
    }
    req.faculty = faculty;
    next();
}

router.use(facultyAuth);

/* ----------------------------------------------------------
   GET /faculty/attendance/courses
   List faculty's assigned courses (with section info)
---------------------------------------------------------- */
router.get("/courses", async (req, res) => {
    try {
        const subjects = await prisma.subject.findMany({
            where: { facultyId: req.faculty.id },
            include: {
                section: {
                    include: {
                        students: {
                            select: { id: true, uid: true, name: true },
                            orderBy: { uid: "asc" }
                        }
                    }
                }
            }
        });

        res.json(subjects);
    } catch (error) {
        console.error("Attendance courses error:", error);
        res.status(500).json({ error: "Failed to fetch courses" });
    }
});

/* ----------------------------------------------------------
   POST /faculty/attendance/session
   Create a lecture (attendance session) for a given date
   Prevents duplicates for same course + section + date
---------------------------------------------------------- */
router.post("/session", async (req, res) => {
    try {
        const { courseId, lectureDate } = req.body;

        if (!courseId || !lectureDate) {
            return res.status(400).json({ error: "courseId and lectureDate required" });
        }

        // Verify faculty teaches this course
        const course = await prisma.subject.findFirst({
            where: { id: parseInt(courseId), facultyId: req.faculty.id }
        });

        if (!course) {
            return res.status(403).json({ error: "You do not teach this course" });
        }

        // Check for duplicate session on same date
        const existing = await prisma.attendanceSession.findUnique({
            where: {
                courseId_sectionId_lectureDate: {
                    courseId: course.id,
                    sectionId: course.sectionId,
                    lectureDate: lectureDate
                }
            }
        });

        if (existing) {
            return res.status(409).json({
                error: "Attendance session already exists for this date",
                sessionId: existing.id
            });
        }

        const session = await prisma.attendanceSession.create({
            data: {
                courseId: course.id,
                sectionId: course.sectionId,
                facultyId: req.faculty.id,
                lectureDate: lectureDate
            }
        });

        res.json({ message: "Attendance session created", session });
    } catch (error) {
        console.error("Create session error:", error);
        res.status(500).json({ error: "Failed to create session" });
    }
});

/* ----------------------------------------------------------
   GET /faculty/attendance/sessions/:courseId
   List all attendance sessions for a course
---------------------------------------------------------- */
router.get("/sessions/:courseId", async (req, res) => {
    try {
        const courseId = parseInt(req.params.courseId);

        // Verify faculty teaches this course
        const course = await prisma.subject.findFirst({
            where: { id: courseId, facultyId: req.faculty.id }
        });

        if (!course) {
            return res.status(403).json({ error: "You do not teach this course" });
        }

        const sessions = await prisma.attendanceSession.findMany({
            where: { courseId, facultyId: req.faculty.id },
            include: {
                records: {
                    include: {
                        student: { select: { id: true, uid: true, name: true } }
                    }
                }
            },
            orderBy: { lectureDate: "desc" }
        });

        res.json(sessions);
    } catch (error) {
        console.error("Fetch sessions error:", error);
        res.status(500).json({ error: "Failed to fetch sessions" });
    }
});

/* ----------------------------------------------------------
   POST /faculty/attendance/mark
   Mark attendance for a session (bulk — all students at once)
   Body: { sessionId, records: [{ studentId, status }] }
---------------------------------------------------------- */
router.post("/mark", async (req, res) => {
    try {
        const { sessionId, records } = req.body;

        if (!sessionId || !records || !Array.isArray(records)) {
            return res.status(400).json({ error: "sessionId and records[] required" });
        }

        // Verify session belongs to this faculty
        const session = await prisma.attendanceSession.findFirst({
            where: { id: parseInt(sessionId), facultyId: req.faculty.id }
        });

        if (!session) {
            return res.status(403).json({ error: "Session not found or not yours" });
        }

        // Check if attendance already marked
        const existingCount = await prisma.attendanceRecord.count({
            where: { sessionId: session.id }
        });

        if (existingCount > 0) {
            return res.status(409).json({ error: "Attendance already marked for this session" });
        }

        // Validate statuses
        for (const r of records) {
            if (!["present", "absent"].includes(r.status)) {
                return res.status(400).json({ error: `Invalid status: ${r.status}` });
            }
        }

        // Bulk create attendance records
        await prisma.attendanceRecord.createMany({
            data: records.map(r => ({
                sessionId: session.id,
                studentId: parseInt(r.studentId),
                status: r.status
            }))
        });

        res.json({
            message: "Attendance marked successfully",
            count: records.length
        });
    } catch (error) {
        console.error("Mark attendance error:", error);
        res.status(500).json({ error: "Failed to mark attendance" });
    }
});

/* ----------------------------------------------------------
   GET /faculty/attendance/:sessionId
   Get attendance details for a specific session
---------------------------------------------------------- */
router.get("/:sessionId", async (req, res) => {
    try {
        const sessionId = parseInt(req.params.sessionId);

        const session = await prisma.attendanceSession.findFirst({
            where: { id: sessionId, facultyId: req.faculty.id },
            include: {
                course: { select: { id: true, name: true } },
                section: { select: { id: true, code: true } },
                records: {
                    include: {
                        student: { select: { id: true, uid: true, name: true } }
                    },
                    orderBy: { student: { uid: "asc" } }
                }
            }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.json(session);
    } catch (error) {
        console.error("Fetch session error:", error);
        res.status(500).json({ error: "Failed to fetch session details" });
    }
});

/* ----------------------------------------------------------
   GET /student/attendance/:uid
   Student's attendance summary across all courses
   (No faculty auth — uses student UID from URL param)
---------------------------------------------------------- */

module.exports = router;
