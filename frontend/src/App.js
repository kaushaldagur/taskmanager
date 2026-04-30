import { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API = "taskmanager-production-9f28.up.railway.app";

const emptyForm = {
  projectName: "",
  taskTitle: "",
  assignedEmail: "",
  selectedProject: ""
};

const decodeToken = (jwt) => {
  try {
    const payload = jwt.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
};

const normalizeStatus = (status) => (status === "done" ? "done" : "pending");

export default function App() {
  const [page, setPage] = useState("login");
  const [view, setView] = useState("projects");
  const [projectMode, setProjectMode] = useState("all");
  const [filter, setFilter] = useState("all");

  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [session, setSession] = useState({ token: "", role: "", name: "", email: "" });

  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectTasks, setProjectTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [openProject, setOpenProject] = useState(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [addType, setAddType] = useState("project");
  const [form, setForm] = useState(emptyForm);

  const isAdmin = session.role === "admin";
  const displayName = session.name || session.email?.split("@")[0] || "User";

  const authHeaders = (token = session.token) => ({
    headers: { Authorization: token }
  });

  const loadTasks = async (token = session.token) => {
    const res = await axios.get(`${API}/tasks`, authHeaders(token));
    setTasks(Array.isArray(res.data) ? res.data : []);
  };

  const loadProjects = async (token = session.token) => {
    const res = await axios.get(`${API}/projects`, authHeaders(token));
    setProjects(Array.isArray(res.data) ? res.data : []);
  };

  const loadStats = async (token = session.token) => {
    const res = await axios.get(`${API}/dashboard`, authHeaders(token));
    setStats(res.data || null);
  };

  const loadProjectTasks = async (projectId, token = session.token) => {
    const res = await axios.get(`${API}/projects/${projectId}/tasks`, authHeaders(token));
    setProjectTasks(Array.isArray(res.data) ? res.data : []);
  };

  const loadDashboard = async (token = session.token) => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadTasks(token), loadProjects(token), loadStats(token)]);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (!savedToken) return;

    const savedProfile = JSON.parse(localStorage.getItem("taskflowProfile") || "{}");
    const decoded = decodeToken(savedToken);
    const nextSession = {
      token: savedToken,
      role: savedProfile.role || decoded.role || "",
      name: savedProfile.name || "",
      email: savedProfile.email || ""
    };

    setSession(nextSession);
    setPage("dashboard");
    loadDashboard(savedToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view !== "projects") {
      setOpenProject(null);
      setProjectTasks([]);
    }
    if (view === "stats" && session.token) {
      loadStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (!openProject || !session.token) return;

    setLoading(true);
    setError("");
    loadProjectTasks(openProject._id)
      .catch((err) => setError(err.response?.data?.message || "Unable to load project tasks"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openProject?._id, session.token]);

  const visibleProjects = useMemo(() => {
    if (isAdmin) return projects;

    const projectIdsWithTasks = new Set(
      tasks.map((task) => task.projectId?._id).filter(Boolean)
    );

    const fromProjects = projects.filter((project) => projectIdsWithTasks.has(project._id));
    const missingFromTasks = tasks
      .map((task) => task.projectId)
      .filter(Boolean)
      .filter((project, index, list) => list.findIndex((item) => item._id === project._id) === index)
      .filter((project) => !fromProjects.some((item) => item._id === project._id));

    return [...fromProjects, ...missingFromTasks];
  }, [isAdmin, projects, tasks]);

  const selectedProjectTasks = useMemo(() => {
    if (!openProject) return [];
    return projectMode === "mine" ? projectTasks.filter((task) => task.assignedTo?.email === session.email) : projectTasks;
  }, [openProject, projectMode, projectTasks, session.email]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const status = normalizeStatus(task.status);
      if (filter === "done") return status === "done";
      if (filter === "pending") return status === "pending";
      return true;
    });
  }, [filter, tasks]);

  const localStats = useMemo(() => {
    const completed = tasks.filter((task) => normalizeStatus(task.status) === "done").length;
    const pending = tasks.length - completed;
    const overdue = tasks.filter((task) => task.overdue).length;

    return {
      total: tasks.length,
      completed,
      pending,
      overdue
    };
  }, [tasks]);

  const getProgress = (projectId) => {
    const project = projects.find((item) => item._id === projectId) || visibleProjects.find((item) => item._id === projectId);
    if (typeof project?.progress === "number") return project.progress;

    const projectTasks = tasks.filter((task) => task.projectId?._id === projectId);
    if (!projectTasks.length) return 0;
    const completed = projectTasks.filter((task) => normalizeStatus(task.status) === "done").length;
    return Math.round((completed / projectTasks.length) * 100);
  };

  const getProjectTaskCount = (projectId) => {
    const project = projects.find((item) => item._id === projectId) || visibleProjects.find((item) => item._id === projectId);
    if (typeof project?.taskCount === "number") return project.taskCount;
    return tasks.filter((task) => task.projectId?._id === projectId).length;
  };

  const updateAuth = (field, value) => {
    setAuthForm((current) => ({ ...current, [field]: value }));
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const login = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const res = await axios.post(`${API}/login`, {
        email: authForm.email.trim(),
        password: authForm.password
      });

      const profile = {
        role: res.data.role || decodeToken(res.data.token).role || "",
        name: res.data.name || authForm.email.split("@")[0],
        email: res.data.email || authForm.email.trim()
      };

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("taskflowProfile", JSON.stringify(profile));

      setSession({ token: res.data.token, ...profile });
      setPage("dashboard");
      setView("projects");
      await loadDashboard(res.data.token);
    } catch (err) {
      setError(err.response?.data?.message || "Login failed");
    } finally {
      setSaving(false);
    }
  };

  const signup = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await axios.post(`${API}/signup`, {
        name: authForm.name.trim(),
        email: authForm.email.trim(),
        password: authForm.password,
        role: "member"
      });

      setPage("login");
      setAuthForm({ name: "", email: "", password: "" });
    } catch (err) {
      setError(err.response?.data?.message || "Signup failed");
    } finally {
      setSaving(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("taskflowProfile");
    setSession({ token: "", role: "", name: "", email: "" });
    setTasks([]);
    setProjects([]);
    setStats(null);
    setOpenProject(null);
    setPage("login");
  };

  const openAddModal = () => {
    setAddType("project");
    setForm(emptyForm);
    setError("");
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setForm(emptyForm);
  };

  const createProject = async (event) => {
    event.preventDefault();
    if (!form.projectName.trim()) {
      setError("Enter project name");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await axios.post(`${API}/projects`, { name: form.projectName.trim() }, authHeaders());
      closeModal();
      await loadDashboard();
    } catch (err) {
      setError(err.response?.data?.message || "Project creation failed");
    } finally {
      setSaving(false);
    }
  };

  const createTask = async (event) => {
    event.preventDefault();
    if (!form.taskTitle.trim() || !form.assignedEmail.trim() || !form.selectedProject) {
      setError("Enter task, email, and project");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await axios.post(
        `${API}/tasks`,
        {
          title: form.taskTitle.trim(),
          assignedEmail: form.assignedEmail.trim(),
          projectId: form.selectedProject
        },
        authHeaders()
      );
      closeModal();
      await loadDashboard();
      if (openProject?._id === form.selectedProject) {
        await loadProjectTasks(form.selectedProject);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Task creation failed");
    } finally {
      setSaving(false);
    }
  };

  const completeTask = async (taskId) => {
    setSaving(true);
    setError("");
    try {
      await axios.put(`${API}/tasks/${taskId}`, {}, authHeaders());
      await loadDashboard();
      if (openProject) {
        await loadProjectTasks(openProject._id);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Could not complete task");
    } finally {
      setSaving(false);
    }
  };

  const renderAuth = () => (
    <main className="auth-shell">
      <style>{globalStyles}</style>
      <form className="auth-card" onSubmit={page === "login" ? login : signup}>
        <div>
          <p className="eyebrow">TaskFlow</p>
          <h1>{page === "login" ? "Welcome back" : "Create account"}</h1>
          <p className="muted">{page === "login" ? "Login to continue to your dashboard." : "Start with a focused member workspace."}</p>
        </div>

        {page === "signup" && (
          <label className="field">
            <span>Name</span>
            <input value={authForm.name} onChange={(event) => updateAuth("name", event.target.value)} placeholder="Kaushal" />
          </label>
        )}

        <label className="field">
          <span>Email</span>
          <input value={authForm.email} onChange={(event) => updateAuth("email", event.target.value)} placeholder="you@example.com" />
        </label>

        <label className="field">
          <span>Password</span>
          <input type="password" value={authForm.password} onChange={(event) => updateAuth("password", event.target.value)} placeholder="Password" />
        </label>

        {error && <div className="notice error">{error}</div>}

        <button className="btn primary wide" type="submit" disabled={saving}>
          {saving ? "Please wait..." : page === "login" ? "Login" : "Signup"}
        </button>

        <button className="text-btn" type="button" onClick={() => {
          setPage(page === "login" ? "signup" : "login");
          setError("");
        }}>
          {page === "login" ? "Create Account" : "Back to Login"}
        </button>
      </form>
    </main>
  );

  const renderProjectCards = () => (
    <>
      <div className="section-head">
        <div>
          <h2>Projects</h2>
          <p>{isAdmin ? "Every workspace project with live task progress." : "Projects where you have assigned work."}</p>
        </div>
      </div>

      {visibleProjects.length === 0 ? (
        <EmptyState title="No projects yet" text={isAdmin ? "Use Add to create your first project." : "Assigned projects will appear here."} />
      ) : (
        <div className="cards-grid">
          {visibleProjects.map((project) => {
            const progress = getProgress(project._id);
            return (
              <button className="project-card" key={project._id} type="button" onClick={() => {
                setOpenProject(project);
                setProjectMode("all");
              }}>
                <div className="card-topline">
                  <h3>{project.name}</h3>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} />
                <p>{getProjectTaskCount(project._id)} task{getProjectTaskCount(project._id) === 1 ? "" : "s"} tracked</p>
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  const renderProjectDetails = () => {
    const progress = getProgress(openProject._id);

    return (
      <section className="panel detail-panel">
        <button className="btn secondary back-btn" type="button" onClick={() => setOpenProject(null)}>
          Back
        </button>

        <div className="detail-header">
          <div>
            <p className="eyebrow">Project</p>
            <h2>{openProject.name}</h2>
            <p>Progress: {progress}%</p>
          </div>
          <div className="progress-ring">{progress}%</div>
        </div>

        <Progress value={progress} />

        {!isAdmin && (
          <div className="segmented">
            <button className={projectMode === "all" ? "active" : ""} type="button" onClick={() => setProjectMode("all")}>All Tasks</button>
            <button className={projectMode === "mine" ? "active" : ""} type="button" onClick={() => setProjectMode("mine")}>My Tasks</button>
          </div>
        )}

        <div className="list-title">{isAdmin ? "All Tasks" : projectMode === "mine" ? "My Tasks" : "All Tasks"}</div>

        {selectedProjectTasks.length === 0 ? (
          <EmptyState title="No tasks yet" text="Tasks for this project will show here." compact />
        ) : (
          <div className="task-list">
            {selectedProjectTasks.map((taskItem) => (
              <TaskRow key={taskItem._id} task={taskItem} isAdmin={isAdmin} showAssignee saving={saving} onComplete={completeTask} />
            ))}
          </div>
        )}
      </section>
    );
  };

  const renderTasks = () => (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>{isAdmin ? "All Tasks" : "My Tasks"}</h2>
          <p>{isAdmin ? "Full system view across users and projects." : "Your assigned work, filtered for focus."}</p>
        </div>
      </div>

      <div className="filters">
        {["all", "done", "pending"].map((item) => (
          <button className={filter === item ? "active" : ""} key={item} type="button" onClick={() => setFilter(item)}>
            {item === "done" ? "Completed" : item.charAt(0).toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {filteredTasks.length === 0 ? (
        <EmptyState title="No tasks yet" text="Tasks matching this filter will appear here." />
      ) : (
        <div className="task-list">
          {filteredTasks.map((taskItem) => (
            <TaskRow key={taskItem._id} task={taskItem} isAdmin={isAdmin} saving={saving} onComplete={completeTask} />
          ))}
        </div>
      )}
    </section>
  );

  const renderStats = () => {
    const source = stats || localStats;
    const cards = isAdmin
      ? [
          ["Total Tasks", source.total],
          ["Completed", source.completed, "success"],
          ["Pending", source.pending, "warning"],
          ["Overdue", source.overdue || 0, "danger"]
        ]
      : [
          ["My Tasks", source.total],
          ["Completed", source.completed, "success"],
          ["Pending", source.pending, "warning"]
        ];

    return (
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Stats</h2>
            <p>{isAdmin ? "Global system metrics." : "Personal metrics only."}</p>
          </div>
        </div>

        <div className="stats-grid">
          {cards.map(([label, value, tone]) => (
            <div className={`stat-card ${tone || ""}`} key={label}>
              <span>{label}</span>
              <strong>{value ?? 0}</strong>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const renderModal = () => {
    if (!showModal) return null;

    return (
      <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}>
        <form className="modal" onSubmit={addType === "project" ? createProject : createTask}>
          <div className="modal-head">
            <div>
              <p className="eyebrow">Add New</p>
              <h2>{addType === "project" ? "Project" : "Task"}</h2>
            </div>
            <button className="icon-btn" type="button" onClick={closeModal} aria-label="Close">x</button>
          </div>

          <div className="choice-row">
            <label className={addType === "project" ? "selected" : ""}>
              <input type="radio" checked={addType === "project"} onChange={() => setAddType("project")} />
              Project
            </label>
            <label className={addType === "task" ? "selected" : ""}>
              <input type="radio" checked={addType === "task"} onChange={() => setAddType("task")} />
              Task
            </label>
          </div>

          {addType === "project" ? (
            <label className="field">
              <span>Name</span>
              <input value={form.projectName} onChange={(event) => updateForm("projectName", event.target.value)} placeholder="Project Alpha" />
            </label>
          ) : (
            <>
              <label className="field">
                <span>Title</span>
                <input value={form.taskTitle} onChange={(event) => updateForm("taskTitle", event.target.value)} placeholder="Design dashboard" />
              </label>

              <label className="field">
                <span>Assign Email</span>
                <input value={form.assignedEmail} onChange={(event) => updateForm("assignedEmail", event.target.value)} placeholder="member@example.com" />
              </label>

              <label className="field">
                <span>Select Project</span>
                <select value={form.selectedProject} onChange={(event) => updateForm("selectedProject", event.target.value)}>
                  <option value="">Choose project</option>
                  {projects.map((project) => (
                    <option key={project._id} value={project._id}>{project.name}</option>
                  ))}
                </select>
              </label>
            </>
          )}

          {error && <div className="notice error">{error}</div>}

          <div className="modal-actions">
            <button className="btn secondary" type="button" onClick={closeModal}>Cancel</button>
            <button className="btn primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Create"}</button>
          </div>
        </form>
      </div>
    );
  };

  if (page === "login" || page === "signup") return renderAuth();

  return (
    <div className="app-shell">
      <style>{globalStyles}</style>

      <header className="topbar">
        <div className="brand">TaskFlow</div>
        <nav className="desktop-nav" aria-label="Current section">Dashboard</nav>
        <div className="topbar-right">
          <span>Hello, {displayName}</span>
          <button className="btn danger" type="button" onClick={logout}>Logout</button>
        </div>
      </header>

      <main className="dashboard">
        <div className="tabs">
          {["projects", "tasks", "stats"].map((item) => (
            <button className={view === item ? "active" : ""} key={item} type="button" onClick={() => setView(item)}>
              {item === "tasks" && !isAdmin ? "Assigned Tasks" : item.charAt(0).toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>

        {error && !showModal && <div className="notice error">{error}</div>}
        {loading ? (
          <div className="loading-card"><span className="spinner" /> Loading workspace...</div>
        ) : (
          <>
            {view === "projects" && (openProject ? renderProjectDetails() : renderProjectCards())}
            {view === "tasks" && renderTasks()}
            {view === "stats" && renderStats()}
          </>
        )}
      </main>

      {isAdmin && (
        <button className="fab" type="button" onClick={openAddModal}>
          + Add
        </button>
      )}

      {renderModal()}
    </div>
  );
}

function Progress({ value }) {
  const tone = value >= 70 ? "high" : value >= 35 ? "mid" : "low";
  return (
    <div className="progress-track" aria-label={`${value}% complete`}>
      <div className={`progress-fill ${tone}`} style={{ width: `${value}%` }} />
    </div>
  );
}

function TaskRow({ task, isAdmin, showAssignee = false, saving, onComplete }) {
  const status = normalizeStatus(task.status);
  const assignee = task.assignedTo?.email || task.assignedTo?.name || "Unassigned";
  const projectName = task.projectId?.name || "No project";

  return (
    <div className="task-row">
      <div className="task-main">
        <strong>{task.title}</strong>
        <span>{isAdmin || showAssignee ? `Assigned to ${assignee}` : projectName}</span>
      </div>
      <div className="task-actions">
        <span className={`status ${status}`}>{status === "done" ? "Done" : "Pending"}</span>
        {status !== "done" && (
          <button className="btn primary small" type="button" disabled={saving} onClick={() => onComplete(task._id)}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, text, compact = false }) {
  return (
    <div className={`empty-state ${compact ? "compact" : ""}`}>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

const globalStyles = `
  * { box-sizing: border-box; }
  body { background: #f5f7fb; color: #1f2937; }
  button, input, select { font: inherit; }
  button { border: 0; }
  .app-shell { min-height: 100vh; background: #f5f7fb; }
  .topbar {
    position: sticky; top: 0; z-index: 20; height: 64px; padding: 0 28px;
    display: flex; align-items: center; justify-content: space-between; gap: 20px;
    background: rgba(255,255,255,.94); border-bottom: 1px solid #e8ecf5;
    backdrop-filter: blur(12px); box-shadow: 0 10px 28px rgba(31, 41, 55, .06);
  }
  .brand { font-size: 20px; font-weight: 800; color: #667eea; }
  .desktop-nav { color: #374151; font-weight: 700; }
  .topbar-right { display: flex; align-items: center; gap: 16px; color: #4b5563; font-weight: 600; }
  .dashboard { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 26px 0 92px; }
  .tabs {
    display: inline-flex; gap: 6px; padding: 6px; margin-bottom: 24px;
    background: #fff; border: 1px solid #e8ecf5; border-radius: 12px;
    box-shadow: 0 12px 30px rgba(31, 41, 55, .07);
  }
  .tabs button, .filters button, .segmented button {
    min-height: 38px; padding: 0 18px; border-radius: 9px; cursor: pointer;
    color: #4b5563; background: transparent; font-weight: 700; transition: .18s ease;
  }
  .tabs button:hover, .filters button:hover, .segmented button:hover { background: #eef2ff; color: #667eea; }
  .tabs .active, .filters .active, .segmented .active { background: #667eea; color: #fff; box-shadow: 0 8px 20px rgba(102,126,234,.28); }
  .section-head { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 18px; }
  h1, h2, h3, p { margin-top: 0; }
  h1 { margin-bottom: 8px; font-size: 32px; }
  h2 { margin-bottom: 6px; font-size: 26px; }
  h3 { margin-bottom: 8px; font-size: 18px; }
  .section-head p, .muted, .detail-header p, .empty-state p { margin-bottom: 0; color: #6b7280; }
  .cards-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
  .project-card, .panel, .auth-card, .modal, .loading-card {
    background: #fff; border: 1px solid #e8ecf5; border-radius: 12px;
    box-shadow: 0 14px 34px rgba(31, 41, 55, .08);
  }
  .project-card {
    min-height: 164px; padding: 18px; text-align: left; cursor: pointer;
    transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
  }
  .project-card:hover { transform: translateY(-4px); border-color: #c7d2fe; box-shadow: 0 20px 44px rgba(31,41,55,.13); }
  .project-card p { margin: 12px 0 0; color: #6b7280; }
  .card-topline { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 22px; }
  .card-topline h3 { margin: 0; color: #111827; }
  .card-topline span { color: #667eea; font-weight: 800; }
  .progress-track { height: 10px; overflow: hidden; background: #edf0f7; border-radius: 999px; }
  .progress-fill { height: 100%; border-radius: inherit; transition: width .28s ease; }
  .progress-fill.high { background: #28a745; }
  .progress-fill.mid { background: #667eea; }
  .progress-fill.low { background: #f59e0b; }
  .panel { padding: 22px; }
  .detail-panel { display: grid; gap: 18px; }
  .detail-header { display: flex; justify-content: space-between; align-items: center; gap: 18px; }
  .progress-ring {
    width: 76px; height: 76px; border-radius: 50%; display: grid; place-items: center;
    color: #667eea; background: #eef2ff; font-weight: 900;
  }
  .back-btn { width: fit-content; }
  .list-title { font-weight: 800; color: #374151; }
  .filters, .segmented { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
  .segmented { margin-bottom: 0; }
  .filters button, .segmented button { background: #eef0f5; }
  .task-list { display: grid; gap: 12px; }
  .task-row {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px; border: 1px solid #edf0f7; border-radius: 10px; background: #fbfcff;
    transition: background .18s ease, border-color .18s ease;
  }
  .task-row:hover { background: #fff; border-color: #c7d2fe; }
  .task-main { display: grid; gap: 4px; min-width: 0; }
  .task-main strong { color: #111827; overflow-wrap: anywhere; }
  .task-main span { color: #6b7280; font-size: 14px; overflow-wrap: anywhere; }
  .task-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .status { padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; }
  .status.done { color: #166534; background: #dcfce7; }
  .status.pending { color: #92400e; background: #fef3c7; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
  .stat-card { padding: 18px; border-radius: 12px; background: #f9fbff; border: 1px solid #edf0f7; }
  .stat-card span { display: block; color: #6b7280; margin-bottom: 10px; font-weight: 700; }
  .stat-card strong { font-size: 34px; color: #111827; }
  .stat-card.success strong { color: #28a745; }
  .stat-card.warning strong { color: #d97706; }
  .stat-card.danger strong { color: #dc3545; }
  .btn {
    min-height: 40px; padding: 0 16px; border-radius: 10px; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    font-weight: 800; transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
  }
  .btn:hover { transform: translateY(-1px); }
  .btn:disabled { opacity: .65; cursor: not-allowed; transform: none; }
  .btn.primary { color: #fff; background: #667eea; box-shadow: 0 10px 20px rgba(102,126,234,.24); }
  .btn.primary:hover { background: #586adb; box-shadow: 0 14px 28px rgba(102,126,234,.32); }
  .btn.secondary { color: #374151; background: #eef0f5; }
  .btn.secondary:hover { background: #e2e6ee; }
  .btn.danger { color: #fff; background: #dc3545; box-shadow: 0 10px 20px rgba(220,53,69,.18); }
  .btn.danger:hover { background: #c82333; }
  .btn.small { min-height: 34px; padding: 0 12px; border-radius: 8px; }
  .btn.wide { width: 100%; }
  .fab {
    position: fixed; right: 28px; bottom: 28px; z-index: 18; min-height: 48px; padding: 0 20px;
    border-radius: 999px; color: #fff; background: #667eea; cursor: pointer; font-weight: 900;
    box-shadow: 0 18px 36px rgba(102,126,234,.34); transition: .18s ease;
  }
  .fab:hover { transform: translateY(-3px); background: #586adb; box-shadow: 0 22px 44px rgba(102,126,234,.42); }
  .auth-shell { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f5f7fb; }
  .auth-card { width: min(420px, 100%); padding: 28px; display: grid; gap: 16px; }
  .eyebrow { margin-bottom: 6px; color: #667eea; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; font-weight: 900; }
  .field { display: grid; gap: 8px; }
  .field span { color: #374151; font-size: 14px; font-weight: 800; }
  .field input, .field select {
    width: 100%; height: 44px; padding: 0 12px; border-radius: 10px;
    border: 1px solid #d9deea; background: #fff; outline: none; transition: .18s ease;
  }
  .field input:focus, .field select:focus { border-color: #667eea; box-shadow: 0 0 0 4px rgba(102,126,234,.13); }
  .text-btn { color: #667eea; background: transparent; cursor: pointer; font-weight: 800; }
  .text-btn:hover { text-decoration: underline; }
  .notice { padding: 12px 14px; border-radius: 10px; font-weight: 700; }
  .notice.error { color: #991b1b; background: #fee2e2; border: 1px solid #fecaca; }
  .empty-state { padding: 44px 20px; text-align: center; color: #6b7280; background: #fff; border: 1px dashed #cfd6e6; border-radius: 12px; }
  .empty-state.compact { padding: 24px 16px; }
  .empty-state h3 { color: #374151; margin-bottom: 6px; }
  .loading-card { min-height: 180px; display: grid; place-items: center; gap: 12px; color: #6b7280; font-weight: 800; }
  .spinner {
    width: 28px; height: 28px; border-radius: 50%; border: 3px solid #e5e7eb; border-top-color: #667eea;
    animation: spin .8s linear infinite;
  }
  .modal-backdrop {
    position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 18px;
    background: rgba(17,24,39,.45);
  }
  .modal { width: min(480px, 100%); padding: 22px; display: grid; gap: 16px; }
  .modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .icon-btn {
    width: 36px; height: 36px; border-radius: 10px; cursor: pointer; color: #4b5563; background: #eef0f5;
    font-weight: 900; transition: .18s ease;
  }
  .icon-btn:hover { background: #e2e6ee; color: #111827; }
  .choice-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .choice-row label {
    min-height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 12px;
    border: 1px solid #d9deea; border-radius: 10px; cursor: pointer; font-weight: 800; background: #fff;
  }
  .choice-row label.selected { border-color: #667eea; color: #667eea; background: #eef2ff; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 680px) {
    .topbar { height: auto; min-height: 64px; padding: 12px 16px; align-items: flex-start; flex-direction: column; }
    .desktop-nav { display: none; }
    .topbar-right { width: 100%; justify-content: space-between; }
    .dashboard { width: min(100% - 24px, 1120px); padding-top: 18px; }
    .tabs { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; }
    .tabs button { padding: 0 10px; }
    .detail-header, .task-row { align-items: flex-start; flex-direction: column; }
    .task-actions { width: 100%; justify-content: space-between; }
    .fab { right: 16px; bottom: 16px; }
  }
`;
