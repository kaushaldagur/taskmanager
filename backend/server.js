const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

app.get("/health", (req, res) => {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];

  res.json({
    api: "ok",
    database: states[mongoose.connection.readyState] || "unknown",
    hasMongoUri: Boolean(process.env.MONGO_URI),
    hasJwtSecret: Boolean(process.env.JWT_SECRET)
  });
});

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// ================= MODELS =================

// USER
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: String,
  role: { type: String, enum: ["admin", "member"], default: "member" }
});

// PROJECT
const projectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
});

// TASK
const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
  status: { type: String, enum: ["todo", "done"], default: "todo" },
  deadline: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
});

const User = mongoose.model("User", userSchema);
const Task = mongoose.model("Task", taskSchema);
const Project = mongoose.model("Project", projectSchema);

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(email || "");
const isDatabaseConnected = () => mongoose.connection.readyState === 1;

const authErrorMessage = (err, fallback) => {
  if (err?.code === 11000) return "User already exists";
  if (err?.name === "ValidationError") return Object.values(err.errors).map(error => error.message).join(", ");
  if (err?.name === "MongooseError" || err?.name === "MongoServerSelectionError") return "Database not connected";
  return fallback;
};

// ================= AUTH =================

const verifyToken = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};

// ================= AUTH ROUTES =================

// SIGNUP
app.post("/signup", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields required" });

    if (!isValidEmail(email))
      return res.status(400).json({ message: "Valid email required" });

    if (password.length < 6)
      return res.status(400).json({ message: "Password must be at least 6 characters" });

    if (!isDatabaseConnected())
      return res.status(503).json({ message: "Database not connected" });

    const exists = await User.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { name: name.trim() }]
    });

    if (exists)
      return res.status(400).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);

    await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashed,
      role: role || "member"
    });

    res.json({ message: "Signup successful" });

  } catch (err) {
    console.error("Signup failed:", err);
    res.status(err?.code === 11000 || err?.name === "ValidationError" ? 400 : 500).json({
      message: authErrorMessage(err, "Signup failed")
    });
  }
});

// LOGIN
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: "Email and password required" });

    if (!isValidEmail(email))
      return res.status(400).json({ message: "Valid email required" });

    if (!isDatabaseConnected())
      return res.status(503).json({ message: "Database not connected" });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(400).json({ message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Wrong password" });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET
    );

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

// CREATE PROJECT
app.post("/projects", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ message: "Admin only" });

    if (!req.body.name || !req.body.name.trim())
      return res.status(400).json({ message: "Project name required" });

    const project = await Project.create({
      name: req.body.name.trim(),
      members: [],
      createdBy: req.user.id
    });

    res.json(project);
  } catch {
    res.status(500).json({ message: "Project creation failed" });
  }
});

// GET PROJECTS
app.get("/projects", verifyToken, async (req, res) => {
  try {
    const attachProgress = async (projects) => {
      const docs = await Promise.all(projects.map(async (project) => {
        const tasks = await Task.find({ projectId: project._id });
        const completed = tasks.filter(task => task.status === "done").length;

        return {
          ...project.toObject(),
          taskCount: tasks.length,
          completedCount: completed,
          progress: tasks.length ? Math.round((completed / tasks.length) * 100) : 0
        };
      }));

      return docs;
    };

    if (req.user.role === "admin") {
      const projects = await Project.find();
      return res.json(await attachProgress(projects));
    }

    const tasks = await Task.find({ assignedTo: req.user.id }).select("projectId");
    const taskProjectIds = tasks.map(task => task.projectId).filter(Boolean).map(String);
    const memberProjects = await Project.find({ members: req.user.id }).select("_id");
    const memberProjectIds = memberProjects.map(project => project._id.toString());
    const projectIds = [...new Set([...taskProjectIds, ...memberProjectIds])];
    const projects = await Project.find({ _id: { $in: projectIds } });

    res.json(await attachProgress(projects));
  } catch {
    res.status(500).json({ message: "Project fetch failed" });
  }
});

// GET TASKS FOR ONE PROJECT
app.get("/projects/:id/tasks", verifyToken, async (req, res) => {
  try {
    if (!isValidId(req.params.id))
      return res.status(400).json({ message: "Valid project id required" });

    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    if (req.user.role !== "admin") {
      const isProjectMember = project.members.some(member => member.toString() === req.user.id);
      const hasAssignedTask = await Task.exists({
        projectId: req.params.id,
        assignedTo: req.user.id
      });

      if (!isProjectMember && !hasAssignedTask)
        return res.status(403).json({ message: "Not allowed" });
    }

    const tasks = await Task.find({ projectId: req.params.id })
      .populate("assignedTo", "name email")
      .populate("projectId", "name");

    const updated = tasks.map(t => ({
      ...t._doc,
      overdue: Boolean(t.deadline && new Date(t.deadline) < new Date())
    }));

    res.json(updated);
  } catch {
    res.status(500).json({ message: "Project tasks fetch failed" });
  }
});

// ================= TASK ROUTES =================

// CREATE TASK (ADMIN)
app.post("/tasks", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ message: "Admin only" });

    const { title, assignedEmail, deadline, projectId } = req.body;

    if (!title || !title.trim() || !assignedEmail || !assignedEmail.trim() || !projectId)
      return res.status(400).json({ message: "Title, email, and project required" });

    if (!isValidEmail(assignedEmail))
      return res.status(400).json({ message: "Valid assigned email required" });

    if (!isValidId(projectId))
      return res.status(400).json({ message: "Valid project id required" });

    const project = await Project.findById(projectId);
    if (!project) return res.status(400).json({ message: "Project not found" });

    const user = await User.findOne({ email: assignedEmail.toLowerCase().trim() });
    if (!user) return res.status(400).json({ message: "User not found" });

    const task = await Task.create({
      title: title.trim(),
      assignedTo: user._id,
      projectId,
      deadline,
      createdBy: req.user.id
    });

    await Project.findByIdAndUpdate(project._id, {
      $addToSet: { members: user._id }
    });

    res.json({ message: "Task created", task });

  } catch {
    res.status(500).json({ message: "Task creation failed" });
  }
});

// GET TASKS
app.get("/tasks", verifyToken, async (req, res) => {
  let tasks;

  if (req.user.role === "admin") {
    tasks = await Task.find()
      .populate("assignedTo", "name email")
      .populate("projectId", "name");
  } else {
    tasks = await Task.find({ assignedTo: req.user.id })
      .populate("assignedTo", "name email")
      .populate("projectId", "name");
  }

  const updated = tasks.map(t => ({
    ...t._doc,
    overdue: Boolean(t.deadline && new Date(t.deadline) < new Date())
  }));

  res.json(updated);
});

// COMPLETE TASK
app.put("/tasks/:id", verifyToken, async (req, res) => {
  if (!isValidId(req.params.id))
    return res.status(400).json({ message: "Valid task id required" });

  const task = await Task.findById(req.params.id);

  if (!task) return res.status(404).json({ message: "Task not found" });

  if (req.user.role !== "admin" && task.assignedTo.toString() !== req.user.id)
    return res.status(403).json({ message: "Not allowed" });

  task.status = "done";
  await task.save();

  res.json(task);
});

// DELETE TASK
app.delete("/tasks/:id", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ message: "Admin only" });

    if (!isValidId(req.params.id))
      return res.status(400).json({ message: "Valid task id required" });

    const task = await Task.findByIdAndDelete(req.params.id);

    if (task) {
      const remainingAssignedTasks = await Task.exists({
        projectId: task.projectId,
        assignedTo: task.assignedTo
      });

      if (!remainingAssignedTasks) {
        await Project.findByIdAndUpdate(task.projectId, {
          $pull: { members: task.assignedTo }
        });
      }
    }

    res.json({ message: "Task deleted" });

  } catch {
    res.status(500).json({ message: "Delete failed" });
  }
});

// ================= USER ROUTES =================

// GET USERS (ADMIN)
app.get("/users", verifyToken, async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ message: "Admin only" });

  const users = await User.find({}, "name email role");
  res.json(users);
});

// DELETE USER
app.delete("/users/:id", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ message: "Admin only" });

    if (!isValidId(req.params.id))
      return res.status(400).json({ message: "Valid user id required" });

    await User.findByIdAndDelete(req.params.id);
    await Task.deleteMany({ assignedTo: req.params.id });
    await Project.updateMany({}, { $pull: { members: req.params.id } });

    res.json({ message: "User deleted" });

  } catch {
    res.status(500).json({ message: "Delete failed" });
  }
});

// ================= DASHBOARD =================

app.get("/dashboard", verifyToken, async (req, res) => {
  let tasks;

  if (req.user.role === "admin") {
    tasks = await Task.find();
  } else {
    tasks = await Task.find({ assignedTo: req.user.id });
  }

  res.json({
    total: tasks.length,
    completed: tasks.filter(t => t.status === "done").length,
    pending: tasks.filter(t => t.status !== "done").length,
    overdue: tasks.filter(t => t.deadline && new Date(t.deadline) < new Date()).length
  });
});

// ================= SERVER =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
