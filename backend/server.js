const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

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
  name: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
});

// TASK
const taskSchema = new mongoose.Schema({
  title: String,
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
  status: { type: String, default: "todo" },
  deadline: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
});

const User = mongoose.model("User", userSchema);
const Task = mongoose.model("Task", taskSchema);
const Project = mongoose.model("Project", projectSchema);

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

    const exists = await User.findOne({
      $or: [{ email }, { name }]
    });

    if (exists)
      return res.status(400).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);

    await User.create({
      name,
      email,
      password: hashed,
      role: role || "member"
    });

    res.json({ message: "Signup successful" });

  } catch {
    res.status(500).json({ message: "Signup failed" });
  }
});

// LOGIN
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
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

  } catch {
    res.status(500).json({ message: "Login failed" });
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
    const projectIds = [...new Set(tasks.map(task => task.projectId).filter(Boolean).map(String))];
    const projects = await Project.find({ _id: { $in: projectIds } });

    res.json(await attachProgress(projects));
  } catch {
    res.status(500).json({ message: "Project fetch failed" });
  }
});

// GET TASKS FOR ONE PROJECT
app.get("/projects/:id/tasks", verifyToken, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    if (req.user.role !== "admin") {
      const hasAssignedTask = await Task.exists({
        projectId: req.params.id,
        assignedTo: req.user.id
      });

      if (!hasAssignedTask)
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

    const project = await Project.findById(projectId);
    if (!project) return res.status(400).json({ message: "Project not found" });

    const user = await User.findOne({ email: assignedEmail });
    if (!user) return res.status(400).json({ message: "User not found" });

    const task = await Task.create({
      title: title.trim(),
      assignedTo: user._id,
      projectId,
      deadline,
      createdBy: req.user.id
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

    await Task.findByIdAndDelete(req.params.id);

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

    await User.findByIdAndDelete(req.params.id);
    await Task.deleteMany({ assignedTo: req.params.id });

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

app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

// ================= SERVER =================
app.listen(5000, () => console.log("Server running on 5000"));
