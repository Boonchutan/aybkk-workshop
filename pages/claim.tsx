/**
 * LINE Account Claim Page
 * Students visit this page after adding the LINE bot to enter their verification code
 * URL: /claim
 */

import { useState } from 'react';
import Head from 'next/head';
import styles from '../styles/Claim.module.css';

export default function ClaimPage() {
  const [code, setCode] = useState('');
  const [studentId, setStudentId] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');

    try {
      const res = await fetch('/api/line/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), studentId: studentId.trim() }),
      });

      const data = await res.json();

      if (data.success) {
        setStatus('success');
        setMessage(data.message || 'Account linked successfully!');
      } else {
        setStatus('error');
        setMessage(data.error || 'Something went wrong');
      }
    } catch (err) {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  };

  return (
    <div className={styles.container}>
      <Head>
        <title>Link LINE Account - AYBKK</title>
      </Head>

      <main className={styles.main}>
        <div className={styles.card}>
          <h1 className={styles.title}>🔗 Link Your LINE</h1>
          <p className={styles.subtitle}>
            Enter the 4-digit code from the AYBKK LINE bot to connect your account.
          </p>

          {status === 'success' ? (
            <div className={styles.success}>
              <span className={styles.checkmark}>✓</span>
              <p>{message}</p>
              <p className={styles.hint}>
                You can now receive check-in reminders and practice tracking directly in LINE!
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.field}>
                <label htmlFor="code">Verification Code</label>
                <input
                  id="code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="1234"
                  maxLength={4}
                  className={styles.codeInput}
                  required
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="studentId">Your Name</label>
                <input
                  id="studentId"
                  type="text"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  placeholder="Enter your name as registered"
                  className={styles.textInput}
                  required
                />
              </div>

              {status === 'error' && (
                <div className={styles.error}>{message}</div>
              )}

              <button
                type="submit"
                className={styles.button}
                disabled={status === 'loading' || code.length !== 4}
              >
                {status === 'loading' ? 'Linking...' : 'Link Account'}
              </button>
            </form>
          )}

          <div className={styles.help}>
            <p>Need help?</p>
            <p>1. Add @aybkk LINE bot</p>
            <p>2. Send any message to get your code</p>
          </div>
        </div>
      </main>
    </div>
  );
}
