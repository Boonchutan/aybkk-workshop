content = open('server.js').read()
endpoint = '''

// POST /api/orientations - Save orientation form and generate journal link
app.post('/api/orientations', async (req, res) => {
  try {
    const { name, wechat, experience, injuries, goals, emergency, size, photoConsent, medicalConsent, language, workshop, gameResults } = req.body;
    const studentId = 'gz-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    const datetime = new Date().toISOString();

    const session = driver.session();
    try {
      await session.run(`
        CREATE (s:Orientation {
          id: $id,
          name: $name,
          wechat: $wechat,
          experience: $experience,
          injuries: $injuries,
          goals: $goals,
          emergency: $emergency,
          size: $size,
          photoConsent: $photoConsent,
          medicalConsent: $medicalConsent,
          language: $language,
          workshop: $workshop,
          gameResults: $gameResults,
          createdAt: datetime($createdAt)
        })
      `, {
        id: studentId,
        name: name,
        wechat: wechat || '',
        experience: experience || '',
        injuries: injuries || '',
        goals: goals || '',
        emergency: emergency || '',
        size: size || '',
        photoConsent: photoConsent || 'yes',
        medicalConsent: medicalConsent || 'yes',
        language: language || 'zh',
        workshop: workshop || 'Guangzhou WS Apr 2026',
        gameResults: JSON.stringify(gameResults || []),
        createdAt: datetime
      });
    } finally {
      await session.close();
    }

    // Generate journal link
    const baseUrl = 'https://aybkk-ashtanga.up.railway.app';
    const journalLink = baseUrl + '/student.html?id=' + studentId + '&name=' + encodeURIComponent(name) + '&lang=' + (language || 'zh') + '&location=guangzhou';

    res.json({ success: true, studentId, journalLink, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
'''

# Find the insertion point: after the /api/students POST closing brace
old = '''    res.json({ success: true, student });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all students'''

if old in content:
    content = content.replace(old, '''    res.json({ success: true, student });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
''' + endpoint + '''

// Get all students''')
    open('server.js', 'w').write(content)
    print('Done, new length:', len(content))
else:
    print('Target not found - checking...')
    idx = content.find('res.json({ success: true, student })')
    print('Found at:', idx)
    print(repr(content[idx-50:idx+100]))
