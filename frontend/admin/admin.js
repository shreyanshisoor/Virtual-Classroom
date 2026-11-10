/* ================================================================
   ADMIN DASHBOARD — Frontend Logic
================================================================ */

const API = window.location.origin;
const adminUid = localStorage.getItem("uid");
const adminName = localStorage.getItem("name");

// Auth guard
if (!adminUid || localStorage.getItem("role") !== "admin") {
    window.location.href = "../idx1.html";
}

document.getElementById("adminName").textContent = adminName || "Admin";
const avatarEl = document.getElementById("avatar");
if (avatarEl) avatarEl.textContent = (adminName || "A").charAt(0).toUpperCase();

/* ── Toast ── */
function showToast(msg, type = "info") {
    const c = document.getElementById("toast-container");
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 3000);
}

/* ── API helper ── */
async function api(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
        headers: { "Content-Type": "application/json", "x-admin-uid": adminUid, ...opts.headers },
        ...opts
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
}

/* ── Navigation ── */
function showPage(page) {
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.getElementById(`page-${page}`).classList.add("active");
    document.querySelector(`[data-page="${page}"]`).classList.add("active");
    document.getElementById("pageTitle").textContent = {
        overview: "Overview", users: "Manage Users", sections: "Manage Sections",
        courses: "Manage Courses", assignments: "Assignments"
    }[page];

    if (page === "overview") loadStats();
    if (page === "users") loadUsers();
    if (page === "sections") loadSections();
    if (page === "courses") loadCourses();
    if (page === "assignments") loadAssignmentDropdowns();
}

function logout() {
    localStorage.clear();
    window.location.href = "../idx1.html";
}

/* ── Modals ── */
function openModal(id) {
    document.getElementById(id).classList.add("open");
    // Load dropdowns for course modal
    if (id === "createCourseModal") loadCourseModalDropdowns();
}
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

/* ================================================================
   OVERVIEW
================================================================ */
async function loadStats() {
    try {
        const s = await api("/admin/stats");
        document.getElementById("statStudents").textContent = s.students;
        document.getElementById("statFaculty").textContent = s.faculty;
        document.getElementById("statSections").textContent = s.sections;
        document.getElementById("statCourses").textContent = s.courses;
    } catch (e) { showToast(e.message, "error"); }
}

/* ================================================================
   USERS
================================================================ */
let currentUserFilter = "all";

function filterUsers(role) {
    currentUserFilter = role;
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    event.target.classList.add("active");
    loadUsers();
}

async function loadUsers() {
    try {
        const query = currentUserFilter !== "all" ? `?role=${currentUserFilter}` : "";
        const users = await api(`/admin/users${query}`);
        const tbody = document.getElementById("usersTableBody");
        tbody.innerHTML = users.map(u => `
      <tr>
        <td>${u.id}</td>
        <td><strong>${u.uid}</strong></td>
        <td>${u.name || "—"}</td>
        <td><span class="badge badge-${u.role}">${u.role}</span></td>
        <td>${u.section || "—"}</td>
        <td><button class="btn-delete" onclick="deleteUser('${u.role}', ${u.id})">Delete</button></td>
      </tr>
    `).join("");
    } catch (e) { showToast(e.message, "error"); }
}

async function createStudent() {
    try {
        const uid = document.getElementById("newStudentUid").value;
        const name = document.getElementById("newStudentName").value;
        const password = document.getElementById("newStudentPass").value;
        if (!uid || !password) return showToast("UID and password required", "error");
        await api("/admin/user/student", { method: "POST", body: JSON.stringify({ uid, name, password }) });
        showToast("Student created!", "success");
        closeModal("createStudentModal");
        document.getElementById("newStudentUid").value = "";
        document.getElementById("newStudentName").value = "";
        document.getElementById("newStudentPass").value = "";
        loadUsers();
    } catch (e) { showToast(e.message, "error"); }
}

async function createFaculty() {
    try {
        const uid = document.getElementById("newFacultyUid").value;
        const name = document.getElementById("newFacultyName").value;
        const password = document.getElementById("newFacultyPass").value;
        if (!uid || !password) return showToast("UID and password required", "error");
        await api("/admin/user/faculty", { method: "POST", body: JSON.stringify({ uid, name, password }) });
        showToast("Faculty created!", "success");
        closeModal("createFacultyModal");
        document.getElementById("newFacultyUid").value = "";
        document.getElementById("newFacultyName").value = "";
        document.getElementById("newFacultyPass").value = "";
        loadUsers();
    } catch (e) { showToast(e.message, "error"); }
}

async function deleteUser(role, id) {
    if (!confirm(`Delete this ${role}?`)) return;
    try {
        await api(`/admin/user/${role}/${id}`, { method: "DELETE" });
        showToast("User deleted", "success");
        loadUsers();
    } catch (e) { showToast(e.message, "error"); }
}

/* ================================================================
   SECTIONS
================================================================ */
async function loadSections() {
    try {
        const sections = await api("/admin/sections");
        const grid = document.getElementById("sectionsGrid");
        grid.innerHTML = sections.map(s => `
      <div class="section-card">
        <h4>${s.code}</h4>
        <div class="meta">Semester ${s.semester} · ${s.branch}</div>
        <div class="student-list">
          <strong>${s.students.length} student(s)</strong>
          ${s.students.slice(0, 5).map(st => `<span>${st.uid} — ${st.name || "N/A"}</span>`).join("")}
          ${s.students.length > 5 ? `<span>...and ${s.students.length - 5} more</span>` : ""}
        </div>
        <div class="meta" style="margin-top:8px"><strong>${s.subjects.length} course(s)</strong></div>
        <div class="section-card-footer">
          <span class="badge badge-student">ID: ${s.id}</span>
          <button class="btn-delete" onclick="deleteSection(${s.id})">Delete</button>
        </div>
      </div>
    `).join("");
    } catch (e) { showToast(e.message, "error"); }
}

async function createSection() {
    try {
        const code = document.getElementById("newSectionCode").value;
        const semester = document.getElementById("newSectionSemester").value;
        const branch = document.getElementById("newSectionBranch").value;
        if (!code || !semester || !branch) return showToast("All fields required", "error");
        await api("/admin/section", { method: "POST", body: JSON.stringify({ code, semester, branch }) });
        showToast("Section created!", "success");
        closeModal("createSectionModal");
        document.getElementById("newSectionCode").value = "";
        document.getElementById("newSectionSemester").value = "";
        document.getElementById("newSectionBranch").value = "";
        loadSections();
    } catch (e) { showToast(e.message, "error"); }
}

async function deleteSection(id) {
    if (!confirm("Delete this section?")) return;
    try {
        await api(`/admin/section/${id}`, { method: "DELETE" });
        showToast("Section deleted", "success");
        loadSections();
    } catch (e) { showToast(e.message, "error"); }
}

/* ================================================================
   COURSES
================================================================ */
async function loadCourses() {
    try {
        const courses = await api("/admin/courses");
        const tbody = document.getElementById("coursesTableBody");
        tbody.innerHTML = courses.map(c => `
      <tr>
        <td>${c.id}</td>
        <td><strong>${c.name}</strong></td>
        <td>${c.section ? c.section.code : "—"}</td>
        <td>${c.faculty ? c.faculty.name || c.faculty.uid : "—"}</td>
        <td><button class="btn-delete" onclick="deleteCourse(${c.id})">Delete</button></td>
      </tr>
    `).join("");
    } catch (e) { showToast(e.message, "error"); }
}

async function loadCourseModalDropdowns() {
    try {
        const [sections, faculty] = await Promise.all([
            api("/admin/sections"),
            api("/admin/users?role=faculty")
        ]);
        document.getElementById("newCourseSectionId").innerHTML =
            `<option value="">Select Section</option>` +
            sections.map(s => `<option value="${s.id}">${s.code}</option>`).join("");
        document.getElementById("newCourseFacultyId").innerHTML =
            `<option value="">Select Faculty</option>` +
            faculty.map(f => `<option value="${f.id}">${f.name || f.uid}</option>`).join("");
    } catch (e) { showToast(e.message, "error"); }
}

async function createCourse() {
    try {
        const name = document.getElementById("newCourseName").value;
        const sectionId = document.getElementById("newCourseSectionId").value;
        const facultyId = document.getElementById("newCourseFacultyId").value;
        if (!name || !sectionId || !facultyId) return showToast("All fields required", "error");
        await api("/admin/course", { method: "POST", body: JSON.stringify({ name, sectionId, facultyId }) });
        showToast("Course created!", "success");
        closeModal("createCourseModal");
        document.getElementById("newCourseName").value = "";
        loadCourses();
    } catch (e) { showToast(e.message, "error"); }
}

async function deleteCourse(id) {
    if (!confirm("Delete this course and all related data?")) return;
    try {
        await api(`/admin/course/${id}`, { method: "DELETE" });
        showToast("Course deleted", "success");
        loadCourses();
    } catch (e) { showToast(e.message, "error"); }
}

/* ================================================================
   ASSIGNMENTS
================================================================ */
async function loadAssignmentDropdowns() {
    try {
        const [students, faculty, sections, courses] = await Promise.all([
            api("/admin/users?role=student"),
            api("/admin/users?role=faculty"),
            api("/admin/sections"),
            api("/admin/courses")
        ]);

        const studentOpts = `<option value="">Select Student</option>` +
            students.map(s => `<option value="${s.id}">${s.uid} — ${s.name || "N/A"}</option>`).join("");
        const facultyOpts = `<option value="">Select Faculty</option>` +
            faculty.map(f => `<option value="${f.id}">${f.uid} — ${f.name || "N/A"}</option>`).join("");
        const sectionOpts = `<option value="">Select Section</option>` +
            sections.map(s => `<option value="${s.id}">${s.code}</option>`).join("");
        const courseOpts = `<option value="">Select Course</option>` +
            courses.map(c => `<option value="${c.id}">${c.name}</option>`).join("");

        document.getElementById("assignStudentId").innerHTML = studentOpts;
        document.getElementById("assignStudentSectionId").innerHTML = sectionOpts;
        document.getElementById("assignTeacherSectionFacultyId").innerHTML = facultyOpts;
        document.getElementById("assignTeacherSectionSectionId").innerHTML = sectionOpts;
        document.getElementById("assignTeacherCourseFacultyId").innerHTML = facultyOpts;
        document.getElementById("assignTeacherCourseCourseId").innerHTML = courseOpts;
        document.getElementById("assignCourseSectionCourseId").innerHTML = courseOpts;
        document.getElementById("assignCourseSectionSectionId").innerHTML = sectionOpts;
    } catch (e) { showToast(e.message, "error"); }
}

async function assignStudentSection() {
    try {
        const studentId = document.getElementById("assignStudentId").value;
        const sectionId = document.getElementById("assignStudentSectionId").value;
        if (!studentId || !sectionId) return showToast("Select both fields", "error");
        const r = await api("/admin/assign-student-section", { method: "POST", body: JSON.stringify({ studentId, sectionId }) });
        showToast(r.message, "success");
    } catch (e) { showToast(e.message, "error"); }
}

async function assignTeacherSection() {
    try {
        const facultyId = document.getElementById("assignTeacherSectionFacultyId").value;
        const sectionId = document.getElementById("assignTeacherSectionSectionId").value;
        if (!facultyId || !sectionId) return showToast("Select both fields", "error");
        const r = await api("/admin/assign-teacher-section", { method: "POST", body: JSON.stringify({ facultyId, sectionId }) });
        showToast(r.message, "success");
    } catch (e) { showToast(e.message, "error"); }
}

async function assignTeacherCourse() {
    try {
        const facultyId = document.getElementById("assignTeacherCourseFacultyId").value;
        const courseId = document.getElementById("assignTeacherCourseCourseId").value;
        if (!facultyId || !courseId) return showToast("Select both fields", "error");
        const r = await api("/admin/assign-teacher-course", { method: "POST", body: JSON.stringify({ facultyId, courseId }) });
        showToast(r.message, "success");
    } catch (e) { showToast(e.message, "error"); }
}

async function assignCourseSection() {
    try {
        const courseId = document.getElementById("assignCourseSectionCourseId").value;
        const sectionId = document.getElementById("assignCourseSectionSectionId").value;
        if (!courseId || !sectionId) return showToast("Select both fields", "error");
        const r = await api("/admin/assign-course-section", { method: "POST", body: JSON.stringify({ courseId, sectionId }) });
        showToast(r.message, "success");
    } catch (e) { showToast(e.message, "error"); }
}

/* ── Init ── */
loadStats();
