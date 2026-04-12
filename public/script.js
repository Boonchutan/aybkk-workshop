// script.js

async function loadJournalEntries() {
    const response = await fetch('/api/journal/students');
    const data = await response.json();
    const journalEntries = data.students;
    const journalList = document.getElementById('journal-entries');
    journalEntries.forEach(entry => {
        const li = document.createElement('li');
        li.textContent = `${entry.studentName}: ${entry.stableToday.join(', ')} | Difficult: ${entry.difficultToday.join(', ')}`;
        journalList.appendChild(li);
    });
}

async function saveAssessment() {
    const notes = document.getElementById('teacher-notes').value;
    const response = await fetch('/api/journal/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: notes, studentId: 'student_id_placeholder', teacherName: 'Boonchu' })
    });
    const result = await response.json();
    document.getElementById('feedback').textContent = 'Assessment saved!';
}

async function sendAssessment() {
    // Logic for sending assessments to students
    // This could include triggering emails or messages
}

document.getElementById('save-button').onclick = saveAssessment;
document.getElementById('send-button').onclick = sendAssessment;

loadJournalEntries();