// Mon Agenda Pro — Firebase Authentication + Cloud Firestore
// Remplacez la configuration ci-dessous par celle fournie par votre console Firebase.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCK0VLuUwZ1LEA8h81f2tKEjo4p7tHSjeU",
  authDomain: "mon-agenda-telephonique.firebaseapp.com",
  projectId: "mon-agenda-telephonique",
  storageBucket: "mon-agenda-telephonique.firebasestorage.app",
  messagingSenderId: "1049995627042",
  appId: "1:1049995627042:web:bb0f28ba387a81e8dbd87b"
};

const $ = (id) => document.getElementById(id);
const authPanel = $("authPanel"), appPanel = $("appPanel");
const authForm = $("authForm"), authMessage = $("authMessage");
const appMessage = $("appMessage"), formMessage = $("formMessage");
const dialog = $("appointmentDialog"), appointmentForm = $("appointmentForm");
let currentUser = null, appointments = [], unsubscribeAppointments = null, activeFilter = "all";
const reminderSeen = new Set();

function showMessage(el, text, success=false) {
  el.textContent = text;
  el.classList.toggle("success", success);
}
function localDateString(date = new Date()) {
  const y = date.getFullYear(), m = String(date.getMonth()+1).padStart(2,"0"), d = String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function appointmentDateTime(a) { return new Date(`${a.date}T${a.time}:00`); }
function escapeHtml(s="") {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function friendlyError(error) {
  const code = error?.code || "";
  const map = {
    "auth/email-already-in-use":"Cette adresse e-mail possède déjà un compte.",
    "auth/invalid-email":"L'adresse e-mail n'est pas valide.",
    "auth/weak-password":"Choisissez un mot de passe d'au moins 6 caractères.",
    "auth/invalid-credential":"Adresse e-mail ou mot de passe incorrect.",
    "auth/network-request-failed":"Connexion Internet indisponible. Réessayez.",
    "permission-denied":"Accès refusé. Vérifiez les règles de sécurité Firestore.",
    "unavailable":"Firebase est temporairement indisponible. Réessayez."
  };
  return map[code] || `Une erreur est survenue (${code || "inconnue"}). Vérifiez la configuration Firebase.`;
}
function appointmentsRef() { return collection(getFirestore(), "users", currentUser.uid, "appointments"); }

$("signupBtn").addEventListener("click", async () => {
  showMessage(authMessage, "");
  try {
    await createUserWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
    showMessage(authMessage, "Compte créé. Vous êtes connecté.", true);
  } catch(e) { showMessage(authMessage, friendlyError(e)); }
});
authForm.addEventListener("submit", async (e) => {
  e.preventDefault(); showMessage(authMessage, "");
  try { await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value); }
  catch(e) { showMessage(authMessage, friendlyError(e)); }
});
$("logoutBtn").addEventListener("click", () => signOut(auth));
$("addBtn").addEventListener("click", () => openDialog());
$("closeDialog").addEventListener("click", closeDialog);
$("cancelDialog").addEventListener("click", closeDialog);
dialog.addEventListener("click", e => { if(e.target === dialog) closeDialog(); });
function closeDialog(){ dialog.close(); appointmentForm.reset(); $("appointmentId").value=""; $("dialogTitle").textContent="Ajouter un rendez-vous"; showMessage(formMessage,""); }
function openDialog(a=null) {
  appointmentForm.reset();
  $("appointmentId").value = a?.id || "";
  $("dialogTitle").textContent = a ? "Modifier le rendez-vous" : "Ajouter un rendez-vous";
  $("clientName").value = a?.clientName || "";
  $("phone").value = a?.phone || "";
  $("status").value = a?.status || "À appeler";
  $("date").value = a?.date || localDateString();
  $("time").value = a?.time || `${String(new Date().getHours()).padStart(2,"0")}:${String(new Date().getMinutes()).padStart(2,"0")}`;
  $("duration").value = String(a?.duration || 30);
  $("reminder").value = String(a?.reminder ?? 10);
  $("notes").value = a?.notes || "";
  showMessage(formMessage,"");
  dialog.showModal();
}
appointmentForm.addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentUser) return;
  const data = {
    clientName: $("clientName").value.trim(),
    phone: $("phone").value.trim(),
    status: $("status").value,
    date: $("date").value,
    time: $("time").value,
    duration: Number($("duration").value),
    reminder: Number($("reminder").value),
    notes: $("notes").value.trim(),
    updatedAt: serverTimestamp()
  };
  if(!data.clientName || !data.date || !data.time) { showMessage(formMessage,"Remplissez le nom, la date et l'heure."); return; }
  try {
    const id = $("appointmentId").value;
    if(id) await updateDoc(doc(getFirestore(),"users",currentUser.uid,"appointments",id),data);
    else await addDoc(appointmentsRef(), {...data, createdAt: serverTimestamp()});
    closeDialog(); showMessage(appMessage, "Rendez-vous enregistré.", true);
  } catch(err) { showMessage(formMessage, friendlyError(err)); }
});
$("searchInput").addEventListener("input", renderAppointments);
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
  activeFilter = btn.dataset.filter;
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===btn));
  renderAppointments();
}));
function renderAppointments() {
  const today = localDateString();
  const term = $("searchInput").value.trim().toLowerCase();
  let filtered = appointments.filter(a => {
    const matchesTerm = `${a.clientName||""} ${a.phone||""} ${a.notes||""}`.toLowerCase().includes(term);
    const dt = appointmentDateTime(a);
    if(activeFilter==="today") return matchesTerm && a.date===today && !["Terminé","Annulé","Absent"].includes(a.status);
    if(activeFilter==="upcoming") return matchesTerm && dt >= new Date() && !["Terminé","Annulé","Absent"].includes(a.status);
    if(activeFilter==="done") return matchesTerm && ["Terminé","Annulé","Absent"].includes(a.status);
    return matchesTerm;
  }).sort((a,b)=>appointmentDateTime(a)-appointmentDateTime(b));
  $("appointmentsList").innerHTML = filtered.map(a => {
    const statusClass = a.status || "À appeler";
    const when = appointmentDateTime(a);
    const dateText = when.toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"});
    return `<article class="appointment">
      <div class="time-block"><strong>${escapeHtml(a.time||"")}</strong><span>${escapeHtml(dateText)}</span></div>
      <div class="appointment-main"><h3>${escapeHtml(a.clientName||"Sans nom")}</h3>
        <div class="appointment-meta">${a.phone?`<span>☎ ${escapeHtml(a.phone)}</span>`:""}<span>${Number(a.duration)||30} min</span><span class="status ${escapeHtml(statusClass)}">${escapeHtml(statusClass)}</span></div>
        ${a.notes?`<p class="appointment-notes">${escapeHtml(a.notes)}</p>`:""}
      </div>
      <div class="appointment-actions">
        <button class="mini-btn" data-action="edit" data-id="${a.id}">Modifier</button>
        ${a.phone?`<a class="mini-btn" href="tel:${encodeURIComponent(a.phone)}">Appeler</a>`:""}
        <button class="mini-btn delete" data-action="delete" data-id="${a.id}">Supprimer</button>
      </div>
    </article>`;
  }).join("");
  $("emptyState").classList.toggle("hidden",filtered.length>0);
  $("todayCount").textContent = appointments.filter(a=>a.date===today&&!["Terminé","Annulé","Absent"].includes(a.status)).length;
  $("pendingCount").textContent = appointments.filter(a=>["À appeler","À rappeler"].includes(a.status)).length;
  $("doneCount").textContent = appointments.filter(a=>a.status==="Terminé").length;
  checkReminders();
}
$("appointmentsList").addEventListener("click", async e => {
  const btn = e.target.closest("[data-action]");
  if(!btn) return;
  const a = appointments.find(x=>x.id===btn.dataset.id);
  if(!a) return;
  if(btn.dataset.action==="edit") openDialog(a);
  if(btn.dataset.action==="delete" && confirm(`Supprimer le rendez-vous de ${a.clientName} ?`)) {
    try { await deleteDoc(doc(getFirestore(),"users",currentUser.uid,"appointments",a.id)); showMessage(appMessage,"Rendez-vous supprimé.",true); }
    catch(err) { showMessage(appMessage,friendlyError(err)); }
  }
});
function checkReminders() {
  const now = new Date();
  const due = appointments.filter(a => {
    if(!a.reminder || ["Terminé","Annulé","Absent"].includes(a.status)) return false;
    const mins = (appointmentDateTime(a)-now)/60000;
    const key = `${a.id}-${a.date}-${a.time}`;
    return mins >= 0 && mins <= Number(a.reminder) && !reminderSeen.has(key);
  });
  due.forEach(a => reminderSeen.add(`${a.id}-${a.date}-${a.time}`));
  const banner = $("reminderBanner");
  if(due.length) {
    banner.innerHTML = `⏰ Rappel : ${due.map(a=>`<strong>${escapeHtml(a.clientName)}</strong> à ${escapeHtml(a.time)}`).join(" · ")}`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
    banner.textContent = "";
  }
}
function startDataListener(user) {
  if(unsubscribeAppointments) unsubscribeAppointments();
  const q = query(appointmentsRef(), orderBy("date","asc"));
  unsubscribeAppointments = onSnapshot(q, snap => {
    appointments = snap.docs.map(d=>({id:d.id,...d.data()}));
    renderAppointments();
    showMessage(appMessage,"Synchronisé avec Firebase.",true);
  }, err => showMessage(appMessage,friendlyError(err)));
}
let app, auth;
try {
  if(firebaseConfig.apiKey.startsWith("REMPLACEZ") || firebaseConfig.appId.startsWith("REMPLACEZ")) {
    throw new Error("CONFIG_MISSING");
  }
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  onAuthStateChanged(auth, user => {
    currentUser = user;
    authPanel.classList.toggle("hidden",!!user);
    appPanel.classList.toggle("hidden",!user);
    $("logoutBtn").classList.toggle("hidden",!user);
    if(user) {
      $("todayLabel").textContent = new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
      startDataListener(user);
    } else {
      if(unsubscribeAppointments) unsubscribeAppointments();
      unsubscribeAppointments = null; appointments=[]; $("appointmentsList").innerHTML="";
    }
  });
  setInterval(checkReminders,30000);
} catch(e) {
  console.error(e);
  authPanel.classList.remove("hidden");
  showMessage(authMessage, e.message==="CONFIG_MISSING" ? "Configuration à terminer : remplacez les valeurs REMPLACEZ… dans app.js par celles de votre application Web Firebase. Consultez LISEZ-MOI.txt." : "Impossible d'initialiser Firebase. Vérifiez la configuration.");
}
