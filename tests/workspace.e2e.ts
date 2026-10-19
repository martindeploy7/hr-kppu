import { test } from '@e2e-dev/web'
import { expect, credentials } from 'e2e'
test('login, master persists after reload, logout revokes session',async({app,screen,browser})=>{
 await app.open('/')
 await expect(screen.getByRole('heading','Masuk ke ruang kerja SDM')).toBeVisible()
 const account=credentials.user('admin')
 await screen.getByLabel('Email akun').fill(account.username)
 await screen.getByLabel('Password').fill(account.password)
 await screen.getByRole('button','Masuk',{exact:true}).tap()
 await expect(screen.getByRole('button','Tambah Data',{exact:true})).toBeVisible()
 await screen.getByRole('button','Tambah Data',{exact:true}).tap()
 await screen.getByRole('button','Input manual',{exact:true}).tap()
 await screen.getByLabel('Nama lengkap').fill('E2E Pegawai Sintetis')
 await screen.getByLabel('NIP (18 digit)',{exact:true}).fill('198001012020011999')
 await screen.getByRole('button','Simpan pegawai',{exact:true}).tap()
 await expect(browser.locator('.sidebar-footer')).toContainText('Tersimpan di server')
 await browser.reload()
 await screen.getByRole('button','Data Pegawai',{exact:true}).tap()
 await expect(screen.getByText('E2E Pegawai Sintetis',{exact:true})).toBeVisible()
 await screen.getByRole('button',/Keluar ·/).tap()
 await expect(screen.getByRole('heading','Masuk ke ruang kerja SDM')).toBeVisible()
})
test('login fits 390px viewport',async({app,screen,browser})=>{
 await browser.setViewport({width:390,height:844});await app.open('/')
 await expect(screen.getByRole('button','Masuk',{exact:true})).toBeVisible()
 expect(await browser.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('source preview, confirm and renamed identical reupload do not duplicate source',async({app,screen,browser})=>{
 await app.open('/')
 const account=credentials.user('admin')
 await screen.getByLabel('Email akun').fill(account.username);await screen.getByLabel('Password').fill(account.password);await screen.getByRole('button','Masuk',{exact:true}).tap()
 await screen.getByRole('button','Impor Sumber',{exact:true}).tap()
 const countBefore=await browser.evaluate(async()=>{const r=await fetch('/api/workspace');const data=await r.json();return data.state.files.filter((f:any)=>f.active!==false).length})
 await browser.locator('input[type="file"]').setInputFiles(['.e2e/fixtures/E2E_Pusat.xlsx'])
 await expect(browser.locator('.import-results')).toBeVisible()
 // Re-runs may already contain this exact fixture; both paths must preserve idempotency.
 const exists=await browser.evaluate(()=>document.body.textContent?.includes('Duplikat identik'))
 if(!exists){await expect(screen.getByRole('button','Konfirmasi impor',{exact:true})).toBeVisible();await screen.getByRole('button','Konfirmasi impor',{exact:true}).tap();await expect(browser.locator('.sidebar-footer')).toContainText('Tersimpan di server')}
 const count=await browser.evaluate(async()=>{const r=await fetch('/api/workspace');const data=await r.json();return data.state.files.filter((f:any)=>f.active!==false).length})
 expect(count).toBe(exists?countBefore:countBefore+1)
 await browser.locator('input[type="file"]').setInputFiles(['.e2e/fixtures/E2E_Renamed.xlsx'])
 await expect(screen.getByText('Duplikat identik; tidak ditambahkan',{exact:true})).toBeVisible()
 expect(await browser.evaluate(async()=>{const r=await fetch('/api/workspace');const d=await r.json();return d.state.files.filter((f:any)=>f.active!==false).length})).toBe(count)
 for(const width of [390,1280]){await browser.setViewport({width,height:844});expect(await browser.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
})
test('workspace refreshes changes committed by another client',async({app,screen,browser})=>{
 await app.open('/');const account=credentials.user('admin')
 await screen.getByLabel('Email akun').fill(account.username);await screen.getByLabel('Password').fill(account.password);await screen.getByRole('button','Masuk',{exact:true}).tap()
 await screen.getByRole('button','Data Pegawai',{exact:true}).tap()
 const name = `E2E Perubahan Admin Lain ${Date.now()}`
 const response=await browser.evaluate(async(name:string)=>{
  const before=await(await fetch('/api/workspace')).json(),id='e2e-refresh-person'
  const person={id,nama:name,nip:'198001012020011998',nika:'',kantor:'Pusat',unit:'',statusKepegawaian:'Belum diketahui',golongan:'',jabatan:'',tanggalLahir:'',jenisKelamin:'',tempatLahir:'',pendidikan:'',disiplinIlmu:'',pelatihan:[],tanggalMulaiKerja:'',alamat:'',kontakDarurat:'',namaKontakDarurat:'',statusPerkawinan:'',agama:'',nomorWhatsApp:'',email:'',statusPegawai:'Aktif',aliases:[],sources:[],derived:[]}
  const result=await fetch('/api/workspace',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:before.revision,patch:{master:[...before.state.master.filter((e:any)=>e.id!==id),person]},reason:'E2E external client update'})});return result.status
 },name);expect(response).toBe(200)
 await expect(screen.getByText(name,{exact:true})).toBeVisible({timeout:22000})
})
