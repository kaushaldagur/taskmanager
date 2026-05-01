const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;
const DB_NAME = process.env.DB_NAME || "taskmanager";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

app.use(cors());
app.use(express.json());

const connectionStates = ["disconnected", "connected", "connecting", "disconnecting"];

const sendError = (res, status, message) => res.status(status).json({ message });
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
const isDbConnected = () => mongoose.connection.readyState === 1;
const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const requireDb = (req, res, next) => {
  if (!isDbConnected()) return sendError(res, 503, "Database not connected");
  next();
};

const authErrorMessage = (err, fallback) => {
  if (err?.code === 11000) return "User already exists";
  if (err?.name === "ValidationError") {
    return Object.values(err.errors).map((error) => error.message).join(", ");
  }
  if (err?.name === "MongoServerSelectionError" || err?.name === "MongooseError") {
    return "Database not connected";
  }
  return fallback;
};

// ================= MODELS =================

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["admin", "member"], default: "member" }
  },
  { timestamps: true }
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    status: { type: String, enum: ["todo", "done"], default: "todo" },
    deadline: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const Project = mongoose.model("Project", projectSchema);
const Task = mongoose.model("Task", taskSchema);

// ================= DB =================

const connectDb = async () => {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is missing");
    return;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: DB_NAME,
      serverSelectionTimeoutMS: 10000
    });
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
  }
};

mongoose.connection.on("disconnected", () => {
  console.warn("MongoDB disconnected");
});

connectDb();

// ================= HEALTH =================

app.get("/", (req, res) => {
  res.send("API is running");
});

app.get("/health", (req, res) => {
  res.json({
    api: "ok",
    database: connectionStates[mongoose.connection.readyState] || "unknown",
    databaseName: mongoose.connection.name || DB_NAME,
    hasMongoUri: Boolean(process.env.MONGO_URI),
    hasJwtSecret: Boolean(process.env.JWT_SECRET),
    port: PORT
  });
});

// ================= AUTH MIDDLEWARE =================

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return sendError(res, 401, "No token");

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return sendError(res, 401, "Invalid token");
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== "admin") return sendError(res, 403, "Admin only");
  next();
};

// ================= AUTH ROUTES =================

app.post("/signup", requireDb, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const role = req.body.role === "admin" ? "admin" : "member";

    if (!name || !email || !password) return sendError(res, 400, "All fields required");
    if (!isValidEmail(email)) return sendError(res, 400, "Valid email required");
    if (password.length < 6) return sendError(res, 400, "Password must be at least 6 characters");

    const exists = await User.findOne({ $or: [{ email }, { name }] });
    if (exists) return sendError(res, 400, "User already exists");

    const hashed = await bcrypt.hash(password, 10);
    await User.create({ name, email, password: hashed, role });

    res.json({ message: "Signup successful" });
  } catch (err) {
    console.error("Signup failed:", err);
    res.status(err?.code === 11000 || err?.name === "ValidationError" ? 400 : 500).json({
      message: authErrorMessage(err, "Signup failed")
    });
  }
});

app.post("/login", requireDb, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) return sendError(res, 400, "Email and password required");
    if (!isValidEmail(email)) return sendError(res, 400, "Valid email required");

    const user = await User.findOne({ email });
    if (!user) return sendError(res, 400, "User not found");

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return sendError(res, 400, "Wrong password");

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

    res.json({
      token,
      role: user.role,
      name: user.name,
      email: user.email
    });
  } catch (err) {
    console.error("Login failed:", err);
    res.status(500).json({ message: authErrorMessage(err, "Login failed") });
  }
});

// ================= PROJECT ROUTES =================

const attachProjectProgress = async (projects) => {
  return Promise.all(
    projects.map(async (project) => {
      const tasks = await Task.find({ projectId: project._id }).select("status");
      const completed = tasks.filter((task) => task.status === "done").length;

      return {
        ...project.toObject(),
        taskCount: tasks.length,
        completedCount: completed,
        progress: tasks.length ? Math.round((completed / tasks.length) * 100) : 0
      };
    })
  );
};

app.post("/projects", requireDb, verifyToken, requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return sendError(res, 400, "Project name required");

    const project = await Project.create({
      name,
      members: [],
      createdBy: req.user.id
    });

    res.json(project);
  } catch (err) {
    console.error("Project creation failed:", err);
    res.status(500).json({ message: "Project creation failed" });
  }
});

app.get("/projects", requireDb, verifyToken, async (req, res) => {
  try {
    if (req.user.role === "admin") {
      const projects = await Project.find().sort({ createdAt: -1 });
      return res.json(await attachProjectProgress(projects));
    }

    const tasks = await Task.find({ assignedTo: req.user.id }).select("projectId");
    const taskProjectIds = tasks.map((task) => task.projectId).filter(Boolean).map(String);
    const memberProjects = await Project.find({ members: req.user.id }).select("_id");
    const memberProjectIds = memberProjects.map((project) => project._id.toString());
    const projectIds = [...new Set([...taskProjectIds, ...memberProjectIds])];
    const projects = await Project.find({ _id: { $in: projectIds } }).sort({ createdAt: -1 });

    res.json(await attachProjectProgress(projects));
  } catch (err) {
    console.error("Project fetch failed:", err);
    res.status(500).json({ message: "Project fetch failed" });
  }
});

app.get("/projects/:id/tasks", requireDb, verifyToken, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return sendError(res, 400, "Valid project id required");

    const project = await Project.findById(req.params.id);
    if (!project) return sendError(res, 404, "Project not found");

    if (req.user.role !== "admin") {
      const isMember = project.members.some((member) => member.toString() === req.user.id);
      const hasTask = await Task.exists({ projectId: project._id, assignedTo: req.user.id });
      if (!isMember && !hasTask) return sendError(res, 403, "Not allowed");
    }

    const tasks = await Task.find({ projectId: project._id })
      .populate("assignedTo", "name email")
      .populate("projectId", "name")
      .sort({ createdAt: -1 });

    res.json(tasks.map(withOverdue));
  } catch (err) {
    console.error("Project tasks fetch failed:", err);
    res.status(500).json({ message: "Project tasks fetch failed" });
  }
});

// ================= TASK ROUTES =================

const withOverdue = (task) => ({
  ...task.toObject(),
  overdue: Boolean(task.deadline && new Date(task.deadline) < new Date() && task.status !== "done")
});

app.post("/tasks", requireDb, verifyToken, requireAdmin, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const assignedEmail = normalizeEmail(req.body.assignedEmail);
    const projectId = req.body.projectId;
    const deadline = req.body.deadline || undefined;

    if (!title || !assignedEmail || !projectId) return sendError(res, 400, "Title, email, and project required");
    if (!isValidEmail(assignedEmail)) return sendError(res, 400, "Valid assigned email required");
    if (!isValidId(projectId)) return sendError(res, 400, "Valid project id required");

    const [project, assignee] = await Promise.all([
      Project.findById(projectId),
      User.findOne({ email: assignedEmail })
    ]);

    if (!project) return sendError(res, 400, "Project not found");
    if (!assignee) return sendError(res, 400, "User not found");

    const task = await Task.create({
      title,
      assignedTo: assignee._id,
      projectId: project._id,
      deadline,
      createdBy: req.user.id
    });

    await Project.findByIdAndUpdate(project._id, {
      $addToSet: { members: assignee._id }
    });

    const populatedTask = await Task.findById(task._id)
      .populate("assignedTo", "name email")
      .populate("projectId", "name");

    res.json({ message: "Task created", task: withOverdue(populatedTask) });
  } catch (err) {
    console.error("Task creation failed:", err);
    res.status(500).json({ message: "Task creation failed" });
  }
});

app.get("/tasks", requireDb, verifyToken, async (req, res) => {
  try {
    const query = req.user.role === "admin" ? {} : { assignedTo: req.user.id };
    const tasks = await Task.find(query)
      .populate("assignedTo", "name email")
      .populate("projectId", "name")
      .sort({ createdAt: -1 });

    res.json(tasks.map(withOverdue));
  } catch (err) {
    console.error("Task fetch failed:", err);
    res.status(500).json({ message: "Task fetch failed" });
  }
});

app.put("/tasks/:id", requireDb, verifyToken, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return sendError(res, 400, "Valid task id required");

    const task = await Task.findById(req.params.id);
    if (!task) return sendError(res, 404, "Task not found");

    if (req.user.role !== "admin" && task.assignedTo.toString() !== req.user.id) {
      return sendError(res, 403, "Not allowed");
    }

    task.status = "done";
    await task.save();

    res.json(task);
  } catch (err) {
    console.error("Task update failed:", err);
    res.status(500).json({ message: "Task update failed" });
  }
});

app.delete("/tasks/:id", requireDb, verifyToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return sendError(res, 400, "Valid task id required");

    const task = await Task.findByIdAndDelete(req.params.id);
    if (task) {
      const remaining = await Task.exists({
        projectId: task.projectId,
        assignedTo: task.assignedTo
      });

      if (!remaining) {
        await Project.findByIdAndUpdate(task.projectId, {
          $pull: { members: task.assignedTo }
        });
      }
    }

    res.json({ message: "Task deleted" });
  } catch (err) {
    console.error("Task delete failed:", err);
    res.status(500).json({ message: "Delete failed" });
  }
});

// ================= USER ROUTES =================

app.get("/users", requireDb, verifyToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, "name email role").sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    console.error("User fetch failed:", err);
    res.status(500).json({ message: "User fetch failed" });
  }
});

app.delete("/users/:id", requireDb, verifyToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return sendError(res, 400, "Valid user id required");

    await User.findByIdAndDelete(req.params.id);
    await Task.deleteMany({ assignedTo: req.params.id });
    await Project.updateMany({}, { $pull: { members: req.params.id } });

    res.json({ message: "User deleted" });
  } catch (err) {
    console.error("User delete failed:", err);
    res.status(500).json({ message: "Delete failed" });
  }
});

// ================= DASHBOARD =================

app.get("/dashboard", requireDb, verifyToken, async (req, res) => {
  try {
    const query = req.user.role === "admin" ? {} : { assignedTo: req.user.id };
    const tasks = await Task.find(query);

    res.json({
      total: tasks.length,
      completed: tasks.filter((task) => task.status === "done").length,
      pending: tasks.filter((task) => task.status !== "done").length,
      overdue: tasks.filter((task) => task.deadline && new Date(task.deadline) < new Date() && task.status !== "done").length
    });
  } catch (err) {
    console.error("Dashboard fetch failed:", err);
    res.status(500).json({ message: "Dashboard fetch failed" });
  }
});

// ================= FALLBACK + SERVER =================

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
