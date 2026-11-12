/**
 * SEED SCRIPT — Virtual Classroom Demo Data
 * Run: node seed.js
 * Seeds: 1 Section, 1 Faculty, 1 Student (linked to section),
 *        2 Subjects, Timetable, Units, Chapters, StudyMaterial, LiveClass
 */

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const prisma = new PrismaClient();

async function main() {
    console.log("🌱  Seeding Virtual Classroom demo data...\n");

    /* ── 1. Create Section ── */
    let section = await prisma.section.upsert({
        where: { code: "CS-A" },
        update: {},
        create: { code: "CS-A", semester: 4, branch: "Computer Science" }
    });
    console.log("✅  Section:", section.code);

    /* ── 2. Faculty ── */
    const facultyHash = await bcrypt.hash("faculty123", 10);
    let faculty = await prisma.faculty.upsert({
        where: { uid: "FAC001" },
        update: {},
        create: { uid: "FAC001", name: "Dr. Sharma", password: facultyHash }
    });
    console.log("✅  Faculty:", faculty.uid, "-", faculty.name);

    /* ── 2b. Admin ── */
    const adminHash = await bcrypt.hash("admin123", 10);
    let admin = await prisma.admin.upsert({
        where: { uid: "ADMIN001" },
        update: {},
        create: { uid: "ADMIN001", name: "System Admin", password: adminHash }
    });
    console.log("✅  Admin:", admin.uid, "-", admin.name);

    /* ── 3. Student linked to section ── */
    const studentHash = await bcrypt.hash("student123", 10);
    let student = await prisma.student.upsert({
        where: { uid: "STU001" },
        update: { sectionId: section.id, name: "Shiv Kumar" },
        create: {
            uid: "STU001",
            name: "Shiv Kumar",
            password: studentHash,
            sectionId: section.id
        }
    });

    // Also patch the previously registered student to have a section
    try {
        await prisma.student.update({
            where: { uid: "24BCS12280STU2024002" },
            data: { sectionId: section.id, name: "Shiv Kumar" }
        });
        console.log("✅  Existing student patched to section");
    } catch (e) {
        // student may not exist, that's fine
    }

    console.log("✅  Student:", student.uid, "-", student.name);

    /* ── 4. Subjects ── */
    let subjectDBMS = await prisma.subject.upsert({
        where: { id: 1 },
        update: {},
        create: {
            name: "Database Management Systems",
            sectionId: section.id,
            facultyId: faculty.id
        }
    }).catch(async () => {
        // If id:1 doesn't exist yet, create fresh
        return prisma.subject.create({
            data: {
                name: "Database Management Systems",
                sectionId: section.id,
                facultyId: faculty.id
            }
        });
    });

    let subjectOS = await prisma.subject.create({
        data: {
            name: "Operating Systems",
            sectionId: section.id,
            facultyId: faculty.id
        }
    }).catch(() => null); // If already exists, skip

    console.log("✅  Subject:", subjectDBMS.name);
    if (subjectOS) console.log("✅  Subject:", subjectOS.name);

    /* ── 5. Timetable ── */
    const days = ["Monday", "Wednesday", "Friday"];
    for (const day of days) {
        await prisma.timetable.create({
            data: {
                day,
                startTime: "10:00 AM",
                endTime: "11:00 AM",
                subjectId: subjectDBMS.id
            }
        }).catch(() => { });
    }
    console.log("✅  Timetable entries added (Mon/Wed/Fri)");

    /* ── 6. Units + Chapters ── */
    const unit1 = await prisma.unit.create({
        data: {
            title: "Unit 1 — Introduction to DBMS",
            order: 1,
            subjectId: subjectDBMS.id
        }
    }).catch(async () => prisma.unit.findFirst({ where: { subjectId: subjectDBMS.id, order: 1 } }));

    const unit2 = await prisma.unit.create({
        data: {
            title: "Unit 2 — Relational Model",
            order: 2,
            subjectId: subjectDBMS.id
        }
    }).catch(async () => prisma.unit.findFirst({ where: { subjectId: subjectDBMS.id, order: 2 } }));

    const ch1 = await prisma.chapter.create({
        data: { title: "Chapter 1.1 — What is DBMS?", order: 1, unitId: unit1.id }
    }).catch(() => null);

    const ch2 = await prisma.chapter.create({
        data: { title: "Chapter 1.2 — ER Diagrams", order: 2, unitId: unit1.id }
    }).catch(() => null);

    const ch3 = await prisma.chapter.create({
        data: { title: "Chapter 2.1 — Relational Algebra", order: 1, unitId: unit2.id }
    }).catch(() => null);

    console.log("✅  Units & Chapters created");

    /* ── 7. Study Materials ── */
    if (ch1) {
        await prisma.studyMaterial.create({
            data: {
                title: "DBMS Introduction Notes.pdf",
                link: "https://www.w3schools.com/sql/sql_intro.asp",
                chapterId: ch1.id
            }
        }).catch(() => { });

        await prisma.studyMaterial.create({
            data: {
                title: "DBMS Slides Unit 1.pptx",
                link: "https://www.geeksforgeeks.org/introduction-of-dbms/",
                chapterId: ch1.id
            }
        }).catch(() => { });
    }

    if (ch2) {
        await prisma.studyMaterial.create({
            data: {
                title: "ER Diagram Tutorial",
                link: "https://www.lucidchart.com/pages/er-diagrams",
                chapterId: ch2.id
            }
        }).catch(() => { });
    }

    console.log("✅  Study materials added");

    /* ── 8. Live Class ── */
    // Schedule one live class 2 hours from now
    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await prisma.liveClass.create({
        data: {
            topic: "Introduction to SQL & Query Optimization",
            link: "https://meet.google.com/demo-virtual-classroom",
            date: twoHoursFromNow,
            subjectId: subjectDBMS.id
        }
    }).catch(() => { });

    // Also one "live now" class (started 10 min ago)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.liveClass.create({
        data: {
            topic: "LIVE: ER Diagram Practice Session",
            link: "https://meet.google.com/live-now-demo",
            date: tenMinAgo,
            subjectId: subjectDBMS.id
        }
    }).catch(() => { });

    console.log("✅  Live classes scheduled (1 live now, 1 upcoming)");

    console.log("\n🎉  Seed complete!\n");
    console.log("   Student  → UID: STU001         Password: student123");
    console.log("   Student  → UID: 24BCS12280STU2024002  Password: student123");
    console.log("   Faculty  → UID: FAC001          Password: faculty123");
    console.log("   Admin    → UID: ADMIN001        Password: admin123");
    console.log("\n   Section  → CS-A  (Semester 4, Computer Science)");
}

// Export for programmatic use
module.exports = { main };

// Only run if executed directly (not imported)
if (require.main === module) {
    main()
        .catch((e) => { console.error("❌ Seed failed:", e.message); process.exit(1); })
        .finally(() => prisma.$disconnect());
}
