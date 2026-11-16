// Перемикання вкладок у popup.html
$('.tab').on('click', function () {
    $('.tab, .panel').removeClass('active');
    $(this).addClass('active');
    $(`#${$(this).data('target')}`).addClass('active');
});