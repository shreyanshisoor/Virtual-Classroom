/**
 * Admin Authentication Middleware
 * Validates that the request comes from an authenticated admin user.
 * Expects header: x-admin-uid
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function adminAuth(req, res, next) {
  try {
    const adminUid = req.headers["x-admin-uid"];

    if (!adminUid) {
      return res.status(401).json({ error: "Admin authentication required" });
    }

    const admin = await prisma.admin.findUnique({
      where: { uid: adminUid }
    });

    if (!admin) {
      return res.status(403).json({ error: "Not authorized as admin" });
    }

    req.admin = admin;
    next();
  } catch (error) {
    console.error("Admin auth error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
}

module.exports = adminAuth;
