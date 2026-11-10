/**
 * Admin Routes — Virtual Classroom
 * All routes are protected by adminAuth middleware.
 */
const express = require("express");
const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");
const adminAuth = require("../middleware/adminAuth");
const { validatePassword } = require("../middleware/validatePassword");

const router = express.Router();
const prisma = new PrismaClient();

/* ==========================================================
   LOGIN (public — no middleware)
========================================================== */

router.post("/login", async (req, res) => {
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

/* ==========================================================
   STATS — Overview counts
========================================================== */

router.get("/stats", adminAuth, async (req, res) => {
    try {
        const [students, faculty, sections, courses] = await Promise.all([
            prisma.student.count(),
            prisma.faculty.count(),
            prisma.section.count(),
            prisma.subject.count()
        ]);

        res.json({ students, faculty, sections, courses });
    } catch (error) {
        console.error("Stats error:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

/* ==========================================================
   USERS — List / Create / Delete
========================================================== */

router.get("/users", adminAuth, async (req, res) => {
    try {
        const { role } = req.query;

        if (role === "student") {
            const students = await prisma.student.findMany({
                include: { section: true },
                orderBy: { id: "desc" }
            });
            return res.json(
                students.map((s) => ({
                    id: s.id,
                    uid: s.uid,
                    name: s.name,
                    role: "student",
                    section: s.section ? s.section.code : null,
                    sectionId: s.sectionId
                }))
            );
        }

        if (role === "faculty") {
            const faculty = await prisma.faculty.findMany({
                include: { subjects: { include: { section: true } } },
                orderBy: { id: "desc" }
            });
            return res.json(
                faculty.map((f) => ({
                    id: f.id,
                    uid: f.uid,
                    name: f.name,
                    role: "faculty",
                    subjects: f.subjects.map((s) => ({
                        id: s.id,
                        name: s.name,
                        section: s.section ? s.section.code : null
                    }))
                }))
            );
        }

        // Return all
        const [students, faculty] = await Promise.all([
            prisma.student.findMany({
                include: { section: true },
                orderBy: { id: "desc" }
            }),
            prisma.faculty.findMany({ orderBy: { id: "desc" } })
        ]);

        const all = [
            ...students.map((s) => ({
                id: s.id,
                uid: s.uid,
                name: s.name,
                role: "student",
                section: s.section ? s.section.code : null,
                sectionId: s.sectionId
            })),
            ...faculty.map((f) => ({
                id: f.id,
                uid: f.uid,
                name: f.name,
                role: "faculty"
            }))
        ];

        res.json(all);
    } catch (error) {
        console.error("Users error:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// Create Faculty
router.post("/user/faculty", adminAuth, async (req, res) => {
    try {
        const { uid, name, password } = req.body;

        if (!uid || !password) {
            return res.status(400).json({ error: "UID and password required" });
        }

        // Password strength validation
        const pwCheck = validatePassword(password);
        if (!pwCheck.valid) {
            return res.status(400).json({ error: pwCheck.error });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const faculty = await prisma.faculty.create({
            data: { uid, name: name || uid, password: hashedPassword }
        });

        res.json({
            message: "Faculty created",
            user: { id: faculty.id, uid: faculty.uid, name: faculty.name }
        });
    } catch (error) {
        if (error.code === "P2002") {
            return res.status(400).json({ error: "UID already exists" });
        }
        res.status(500).json({ error: "Failed to create faculty" });
    }
});

// Create Student
router.post("/user/student", adminAuth, async (req, res) => {
    try {
        const { uid, name, password, sectionId } = req.body;

        if (!uid || !password) {
            return res.status(400).json({ error: "UID and password required" });
        }

        // Password strength validation
        const pwCheck = validatePassword(password);
        if (!pwCheck.valid) {
            return res.status(400).json({ error: pwCheck.error });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const student = await prisma.student.create({
            data: {
                uid,
                name: name || uid,
                password: hashedPassword,
                sectionId: sectionId ? parseInt(sectionId) : null
            }
        });

        res.json({
            message: "Student created",
            user: { id: student.id, uid: student.uid, name: student.name }
        });
    } catch (error) {
        if (error.code === "P2002") {
            return res.status(400).json({ error: "UID already exists" });
        }
        res.status(500).json({ error: "Failed to create student" });
    }
});

// Delete User
router.delete("/user/:role/:id", adminAuth, async (req, res) => {
    try {
        const { role, id } = req.params;
        const userId = parseInt(id);

        if (role === "student") {
            // Delete related quiz submissions first
            await prisma.quizSubmission.deleteMany({ where: { studentId: userId } });
            await prisma.student.delete({ where: { id: userId } });
        } else if (role === "faculty") {
            // Cannot delete faculty with assigned subjects
            const subjectCount = await prisma.subject.count({ where: { facultyId: userId } });
            if (subjectCount > 0) {
                return res.status(400).json({
                    error: "Cannot delete faculty with assigned courses. Reassign courses first."
                });
            }
            await prisma.faculty.delete({ where: { id: userId } });
        } else {
            return res.status(400).json({ error: "Invalid role" });
        }

        res.json({ message: `${role} deleted successfully` });
    } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).json({ error: "Failed to delete user" });
    }
});

/* ==========================================================
   SECTIONS — CRUD
========================================================== */

router.post("/section", adminAuth, async (req, res) => {
    try {
        const { code, semester, branch } = req.body;

        if (!code || !semester || !branch) {
            return res.status(400).json({ error: "Code, semester, and branch required" });
        }

        const section = await prisma.section.create({
            data: { code, semester: parseInt(semester), branch }
        });

        res.json({ message: "Section created", section });
    } catch (error) {
        if (error.code === "P2002") {
            return res.status(400).json({ error: "Section code already exists" });
        }
        res.status(500).json({ error: "Failed to create section" });
    }
});

router.get("/sections", adminAuth, async (req, res) => {
    try {
        const sections = await prisma.section.findMany({
            include: {
                students: { select: { id: true, uid: true, name: true } },
                subjects: {
                    include: {
                        faculty: { select: { id: true, uid: true, name: true } }
                    }
                }
            },
            orderBy: { id: "desc" }
        });

        res.json(sections);
    } catch (error) {
        console.error("Sections error:", error);
        res.status(500).json({ error: "Failed to fetch sections" });
    }
});

router.delete("/section/:id", adminAuth, async (req, res) => {
    try {
        const sectionId = parseInt(req.params.id);

        // Unlink students from this section
        await prisma.student.updateMany({
            where: { sectionId },
            data: { sectionId: null }
        });

        // Check if section has subjects
        const subjectCount = await prisma.subject.count({ where: { sectionId } });
        if (subjectCount > 0) {
            return res.status(400).json({
                error: "Cannot delete section with courses. Remove courses first."
            });
        }

        await prisma.section.delete({ where: { id: sectionId } });

        res.json({ message: "Section deleted successfully" });
    } catch (error) {
        console.error("Delete section error:", error);
        res.status(500).json({ error: "Failed to delete section" });
    }
});

/* ==========================================================
   COURSES (Subjects) — CRUD
========================================================== */

router.post("/course", adminAuth, async (req, res) => {
    try {
        const { name, sectionId, facultyId } = req.body;

        if (!name || !sectionId || !facultyId) {
            return res.status(400).json({ error: "Name, sectionId, and facultyId required" });
        }

        const course = await prisma.subject.create({
            data: {
                name,
                sectionId: parseInt(sectionId),
                facultyId: parseInt(facultyId)
            }
        });

        res.json({ message: "Course created", course });
    } catch (error) {
        console.error("Create course error:", error);
        res.status(500).json({ error: "Failed to create course" });
    }
});

router.get("/courses", adminAuth, async (req, res) => {
    try {
        const courses = await prisma.subject.findMany({
            include: {
                section: true,
                faculty: { select: { id: true, uid: true, name: true } }
            },
            orderBy: { id: "desc" }
        });

        res.json(courses);
    } catch (error) {
        console.error("Courses error:", error);
        res.status(500).json({ error: "Failed to fetch courses" });
    }
});

router.delete("/course/:id", adminAuth, async (req, res) => {
    try {
        const courseId = parseInt(req.params.id);

        // Delete dependent data in order
        // 1. Study materials (via chapters via units)
        const units = await prisma.unit.findMany({
            where: { subjectId: courseId },
            include: { chapters: true }
        });

        for (const unit of units) {
            for (const chapter of unit.chapters) {
                await prisma.studyMaterial.deleteMany({ where: { chapterId: chapter.id } });
            }
            await prisma.chapter.deleteMany({ where: { unitId: unit.id } });
            // Delete quiz submissions and questions
            const quizzes = await prisma.quiz.findMany({ where: { unitId: unit.id } });
            for (const quiz of quizzes) {
                await prisma.quizSubmission.deleteMany({ where: { quizId: quiz.id } });
                await prisma.question.deleteMany({ where: { quizId: quiz.id } });
            }
            await prisma.quiz.deleteMany({ where: { unitId: unit.id } });
        }
        await prisma.unit.deleteMany({ where: { subjectId: courseId } });

        // 2. Timetables and live classes
        await prisma.timetable.deleteMany({ where: { subjectId: courseId } });
        await prisma.liveClass.deleteMany({ where: { subjectId: courseId } });

        // 3. Delete the subject itself
        await prisma.subject.delete({ where: { id: courseId } });

        res.json({ message: "Course deleted successfully" });
    } catch (error) {
        console.error("Delete course error:", error);
        res.status(500).json({ error: "Failed to delete course" });
    }
});

/* ==========================================================
   ASSIGNMENTS
========================================================== */

// Assign Student → Section
router.post("/assign-student-section", adminAuth, async (req, res) => {
    try {
        const { studentId, sectionId } = req.body;

        if (!studentId || !sectionId) {
            return res.status(400).json({ error: "studentId and sectionId required" });
        }

        const student = await prisma.student.update({
            where: { id: parseInt(studentId) },
            data: { sectionId: parseInt(sectionId) }
        });

        res.json({
            message: "Student assigned to section",
            student: { id: student.id, uid: student.uid, sectionId: student.sectionId }
        });
    } catch (error) {
        console.error("Assign student error:", error);
        res.status(500).json({ error: "Failed to assign student to section" });
    }
});

// Assign Teacher → Section (create a subject placeholder or assign all section courses)
router.post("/assign-teacher-section", adminAuth, async (req, res) => {
    try {
        const { facultyId, sectionId } = req.body;

        if (!facultyId || !sectionId) {
            return res.status(400).json({ error: "facultyId and sectionId required" });
        }

        // Update all unassigned courses in this section to this faculty
        // Or get section courses assigned to this faculty
        const updated = await prisma.subject.updateMany({
            where: {
                sectionId: parseInt(sectionId),
                facultyId: parseInt(facultyId)
            },
            data: {} // no-op, just verifying the relationship exists
        });

        // Actually, assign teacher to section means "this faculty now teaches in this section"
        // Best approach: update all courses in section that don't have a faculty yet
        // But in current schema, every subject requires a facultyId.
        // So the meaningful action is: reassign all section courses to this faculty
        const result = await prisma.subject.updateMany({
            where: { sectionId: parseInt(sectionId) },
            data: { facultyId: parseInt(facultyId) }
        });

        res.json({
            message: `Faculty assigned to section. ${result.count} course(s) updated.`
        });
    } catch (error) {
        console.error("Assign teacher-section error:", error);
        res.status(500).json({ error: "Failed to assign teacher to section" });
    }
});

// Assign Teacher → Course
router.post("/assign-teacher-course", adminAuth, async (req, res) => {
    try {
        const { facultyId, courseId } = req.body;

        if (!facultyId || !courseId) {
            return res.status(400).json({ error: "facultyId and courseId required" });
        }

        const course = await prisma.subject.update({
            where: { id: parseInt(courseId) },
            data: { facultyId: parseInt(facultyId) }
        });

        res.json({
            message: "Teacher assigned to course",
            course: { id: course.id, name: course.name, facultyId: course.facultyId }
        });
    } catch (error) {
        console.error("Assign teacher-course error:", error);
        res.status(500).json({ error: "Failed to assign teacher to course" });
    }
});

// Assign Course → Section
router.post("/assign-course-section", adminAuth, async (req, res) => {
    try {
        const { courseId, sectionId } = req.body;

        if (!courseId || !sectionId) {
            return res.status(400).json({ error: "courseId and sectionId required" });
        }

        const course = await prisma.subject.update({
            where: { id: parseInt(courseId) },
            data: { sectionId: parseInt(sectionId) }
        });

        res.json({
            message: "Course assigned to section",
            course: { id: course.id, name: course.name, sectionId: course.sectionId }
        });
    } catch (error) {
        console.error("Assign course-section error:", error);
        res.status(500).json({ error: "Failed to assign course to section" });
    }
});

module.exports = router;
