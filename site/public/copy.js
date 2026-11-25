document.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-copy]')
  if (!button) return
  const show = (label) => {
    button.textContent = label
    setTimeout(() => (button.textContent = 'Copy'), 2000)
  }
  const select = () => {
    const range = document.createRange()
    range.selectNodeContents(button.parentElement.querySelector('code'))
    getSelection().removeAllRanges()
    getSelection().addRange(range)
    show('Selected')
  }
  if (!navigator.clipboard) return select()
  navigator.clipboard.writeText(button.dataset.copy).then(() => show('Copied'), select)
})
